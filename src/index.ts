/*
 * Copyright 2021 SpinalCom - www.spinalcom.com
 *
 * This file is part of SpinalCore.
 *
 * Please read all of the following terms and conditions
 * of the Free Software license Agreement ("Agreement")
 * carefully.
 *
 * This Agreement is a legally binding contract between
 * the Licensee (as defined below) and SpinalCom that
 * sets forth the terms and conditions that govern your
 * use of the Program. By installing and/or using the
 * Program, you agree to abide by all the terms and
 * conditions stated or referenced herein.
 *
 * If you do not agree to abide by these terms and
 * conditions, do not demonstrate your acceptance and do
 * not install or use the Program.
 * You should have received a copy of the license along
 * with this file. If not, see
 * <http://resources.spinalcom.com/licenses.pdf>.
 */

import ConfigFile from 'spinal-lib-organ-monitoring';
import {
  Process,
  spinalCore,
  FileSystem,
  Model,
  BindProcess,
} from 'spinal-core-connectorjs_type';
import {
  SpinalGraphService,
  SpinalContext,
  SpinalNodeRef,
} from 'spinal-env-viewer-graph-service';
import {
  spinalAnalyticService,
  ANALYTIC_RESULT_TYPE,
  CATEGORY_ATTRIBUTE_ALGORTHM_PARAMETERS,
  CATEGORY_ATTRIBUTE_ANALYTIC_PARAMETERS,
  CATEGORY_ATTRIBUTE_TRIGGER_PARAMETERS,
  ANALYTIC_STATUS,
  ATTRIBUTE_ANALYTIC_STATUS,
  getValueModelFromEntry,
  ATTRIBUTE_VALUE_SEPARATOR,
  TRIGGER_TYPE,
  ATTRIBUTE_TRIGGER_AT_START,
  isResultSuccess,
  isGChatMessageResult,
  isGChatOrganCardResult
} from 'spinal-model-analysis';
import { GoogleChatService} from 'spinal-service-gchat-messenger';
import { CronJob } from 'cron';
import { performance } from 'perf_hooks';
import moment from 'moment';
import { setInterval } from 'timers';
require('dotenv').config();



type ModelBinding = {
  entity: SpinalNodeRef;
  model: Model;
  bindProcess: Process;
};

type TriggerProcesses = {
  Intervals: NodeJS.Timeout[];
  Bindings: ModelBinding[];
  CronJobs: CronJob[];
};
type AnalyticProcesses = {
  [analyticId: string]: TriggerProcesses;
};

class SpinalMain {

  constructor() {}
  private handledAnalytics: AnalyticProcesses;
  private durations: number[];
  private googleChatService: GoogleChatService;

  public init() {
    this.handledAnalytics = {};
    this.durations = [];

    console.log('Init connection to Google Services...');
    this.googleChatService = new GoogleChatService(process.env.GSERVICE_ACCOUNT_EMAIL,process.env.GSERVICE_ACCOUNT_KEY);
    console.log('Done.');
    console.log('Init connection to HUB...');
    const url = `${process.env.SPINALHUB_PROTOCOL}://${process.env.USER_ID}:${process.env.USER_PASSWORD}@${process.env.SPINALHUB_IP}:${process.env.SPINALHUB_PORT}/`;
    const conn = spinalCore.connect(url);
    ConfigFile.init(
      conn,
      process.env.ORGAN_NAME,
      process.env.ORGAN_TYPE,
      process.env.SPINALHUB_IP,
      parseInt(process.env.SPINALHUB_PORT)
    );
    return new Promise((resolve, reject) => {
      spinalCore.load(
        conn,
        process.env.DIGITALTWIN_PATH,
        async (graph: any) => {
          await SpinalGraphService.setGraph(graph);
          console.log('Done.');
          resolve(graph);
        },
        () => {
          console.log(
            'Connection failed ! Please check your config file and the state of the hub.'
          );
          reject();
        }
      );
    });
  }

  public async getSpinalGeo(): Promise<SpinalContext<any>> {
    const context = SpinalGraphService.getContext('spatial');
    return context;
  }

  async initContext(): Promise<void> {
    const spinalGeo = await this.getSpinalGeo();
    await spinalGeo.findInContext(spinalGeo, (node) => {
      // @ts-ignore
      SpinalGraphService._addNode(node);
      return false;
    });
  }

  private async handleAnalyticExecution(id: string, entity?: SpinalNodeRef) {
    const startTime = performance.now();
    const date = moment().format('MMMM Do YYYY, h:mm:ss a');
    console.log(`Executing analytic at ${date} ...`);
    if (entity) {
      spinalAnalyticService.doAnalysisOnEntity(id, entity).then((result) => {
        const endTime = performance.now();
        const elapsedTime = endTime - startTime;
          if(result && isResultSuccess(result) && ([ANALYTIC_RESULT_TYPE.GCHAT_MESSAGE, ANALYTIC_RESULT_TYPE.GCHAT_ORGAN_CARD].includes(result.resultType))) {
            if(isGChatMessageResult(result)) this.googleChatService.sendTextMessage(result.spaceName, result.message)
            if(isGChatOrganCardResult(result))  this.googleChatService.sendCardMessage(result.spaceName, result.card)
          }
        console.log(`Analysis completed in ${elapsedTime.toFixed(2)}ms`);
        this.durations.push(elapsedTime);
      });
    } else {
      spinalAnalyticService.doAnalysis(id).then((results) => {
        const endTime = performance.now();
        const elapsedTime = endTime - startTime;
        for(const result of results){
          if(result && isResultSuccess(result) && ([ANALYTIC_RESULT_TYPE.GCHAT_MESSAGE, ANALYTIC_RESULT_TYPE.GCHAT_ORGAN_CARD].includes(result.resultType))) {
            if(isGChatMessageResult(result)) {
              console.log('Sending message to space : ', result.spaceName)
              this.googleChatService.sendTextMessage(result.spaceName, result.message)
            }
            if(isGChatOrganCardResult(result))  this.googleChatService.sendCardMessage(result.spaceName, result.card)
          }
        }
        console.log(`Analysis completed in ${elapsedTime.toFixed(2)}ms`);
        this.durations.push(elapsedTime);
      });
    }
  }

  private async handleAnalytic(analytic: SpinalNodeRef) {
    const config = await spinalAnalyticService.getConfig(analytic.id.get());
    const analyticConfig = await spinalAnalyticService.getAttributesFromNode(
      config.id.get(),
      CATEGORY_ATTRIBUTE_ANALYTIC_PARAMETERS
    );
    const isForceTrigger = analyticConfig[ATTRIBUTE_TRIGGER_AT_START];
    const triggerParams = await spinalAnalyticService.getAttributesFromNode(
      config.id.get(),
      CATEGORY_ATTRIBUTE_TRIGGER_PARAMETERS
    );
    if (isForceTrigger) {
      console.log('Force trigger at start');
      this.handleAnalyticExecution(analytic.id.get());
    }

    for (const trigger of Object.keys(triggerParams)) {
      const paramList = triggerParams[trigger].split(ATTRIBUTE_VALUE_SEPARATOR);
      switch (paramList[0]) {
        case TRIGGER_TYPE.INTERVAL_TIME: {
          console.log('Interval time : ', paramList[1]);
          const interval = setInterval(() => {
            this.handleAnalyticExecution(analytic.id.get());
          }, paramList[1]);
          this.handledAnalytics[analytic.id.get()].Intervals.push(interval);
          break;
        }
        case TRIGGER_TYPE.CHANGE_OF_VALUE: {
          const entities =
            await spinalAnalyticService.getWorkingFollowedEntities(
              analytic.id.get()
            );
          const targetIndex = paramList[1];
          console.log('COV ON : ', targetIndex);
          for (const entity of entities) {
            const entryDataModel =
              await spinalAnalyticService.getEntryDataModelByInputIndex(
                analytic.id.get(),
                entity,
                targetIndex
              );
            const valueModel: Model = await getValueModelFromEntry(
              entryDataModel
            );
            let previousValue = valueModel.get(); // store the previous value
            const bindProcess = valueModel.bind(() => {
              if (valueModel.get() === previousValue) {
                console.log('Value not changed, skipping analysis...');
              } else {
                previousValue = valueModel.get();
                console.log('Value changed, starting analysis...');
                this.handleAnalyticExecution(analytic.id.get(), entity);
              }
            }, false);
            this.handledAnalytics[analytic.id.get()].Bindings.push({
              entity: entity,
              model: valueModel,
              bindProcess: bindProcess,
            });
          }

          break;
        }
        case TRIGGER_TYPE.CHANGE_OF_VALUE_WITH_THRESHOLD: {
          const entities =
            await spinalAnalyticService.getWorkingFollowedEntities(
              analytic.id.get()
            );
          const targetIndex = paramList[1];
          console.log('COVWT ON : ', targetIndex);
          for (const entity of entities) {
            const entryDataModel =
              await spinalAnalyticService.getEntryDataModelByInputIndex(
                analytic.id.get(),
                entity,
                targetIndex
              );
            if (!entryDataModel) continue;
            const valueModel = await getValueModelFromEntry(entryDataModel);
            console.log('ValueModel : ', valueModel.get());
            let previousValue = valueModel.get(); // store the previous value
            const bindProcess = valueModel.bind(() => {
              if (Math.abs(valueModel.get() - previousValue) <= paramList[2]) {
                console.log(
                  'Value change lower than trigger threshold, skipping analysis...'
                );
              } else {
                previousValue = valueModel.get();
                console.log('Value changed, starting analysis...');
                this.handleAnalyticExecution(analytic.id.get(), entity);
              }
            }, false);
            this.handledAnalytics[analytic.id.get()].Bindings.push({
              entity: entity,
              model: valueModel,
              bindProcess: bindProcess,
            });
          }
          break;
        }
        case TRIGGER_TYPE.CRON: {
          console.log('CRON ON : ', paramList[1]);
          const cronJob = new CronJob(paramList[1], () => {
            this.handleAnalyticExecution(analytic.id.get());
          });
          cronJob.start();
          this.handledAnalytics[analytic.id.get()].CronJobs.push(cronJob);

          break;
        }
        default: {
          console.log('Unknown trigger type : ', paramList[0]);
          break;
        }
      }
    }
  }
  
  public async initJob() {
    const contexts = spinalAnalyticService.getContexts();
    for (const context of contexts) {
      const analytics = await spinalAnalyticService.getAllAnalytics(
        context.id.get()
      );
      for (const analytic of analytics) {
        const config = await spinalAnalyticService.getConfig(analytic.id.get());
        const analyticConfig =
          await spinalAnalyticService.getAttributesFromNode(
            config.id.get(),
            CATEGORY_ATTRIBUTE_ANALYTIC_PARAMETERS
          );

        // Get the status of the analytic
        const isActive =
          analyticConfig[ATTRIBUTE_ANALYTIC_STATUS] === ANALYTIC_STATUS.ACTIVE;
        if (!isActive && analytic.id.get() in this.handledAnalytics) {
          console.log('Analytic has been desactivated. Unhandling ...');
          // remove all intervals and bindings then delete the analytic from handledAnalytics
          this.clearAnalytic(analytic.id.get());
          continue;
        }
        // Check if the analytic is already handled
        if (!isActive && !(analytic.id.get() in this.handledAnalytics)) {
          continue;
        }

        if (isActive && analytic.id.get() in this.handledAnalytics) {
          console.log('Analytic already handled, skipping...');
          // Analytic already handled so skip
          continue;
        }

        //Handle the analytic
        console.log('Handling Analytic : ', analytic.name.get());
        this.handledAnalytics[analytic.id.get()] = {
          Intervals: [],
          Bindings: [],
          CronJobs: [],
        };
        this.handleAnalytic(analytic);
      }
    }
  }

  private getAverageDuration() {
    return (
      this.durations.reduce((sum, curr) => sum + curr, 0) /
      this.durations.length
    );
  }


  public resetReportVariables() {
    this.durations = [];
  }

  private clearTriggers(analyticId: string) {
    for (const interval of this.handledAnalytics[analyticId].Intervals) {
      clearInterval(interval);
    }
    for (const cronJob of this.handledAnalytics[analyticId].CronJobs) {
      cronJob.stop();
    }
    for (const binding of this.handledAnalytics[analyticId].Bindings) {
      binding.model.unbind(binding.bindProcess);
    }
  }

  private clearAnalytic(analyticId: string) {
    this.clearTriggers(analyticId);
    delete this.handledAnalytics[analyticId];
  }
}

async function Main() {
  const spinalMain = new SpinalMain();
  await spinalMain.init();
  spinalAnalyticService.initTwilioCredentials(
    process.env.TWILIO_SID,
    process.env.TWILIO_TOKEN,
    process.env.TWILIO_NUMBER
  );

  await spinalMain.initJob();

  setInterval(async () => {
    await spinalMain.initJob();
    spinalMain.resetReportVariables();
  }, parseInt(process.env.UPDATE_ANALYTIC_QUEUE_TIMER));

  // let next = Date.now() + parseInt(process.env.UPDATE_ANALYTIC_QUEUE_TIMER);

  // while (true) {
  //   if(Date.now() >= next) await spinalMain.initJob();
  //   else await wait();
  //   next = Date.now() + parseInt(process.env.UPDATE_ANALYTIC_QUEUE_TIMER);
  // }

  // function wait() {
  //   return new Promise((resolve, reject) => {
  //     setTimeout(() => {
  //       resolve(true)
  //     }, 500);
  //   });
  // }

  /*setInterval(() => {
    spinalMain.generateReport();
    spinalMain.resetReportVariables();
  }, parseInt(process.env.REPORT_TIMER));*/
}
Main();
