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
import { Process, spinalCore, FileSystem } from 'spinal-core-connectorjs_type';
import {
  SpinalGraphService,
  SpinalContext,
  SpinalNodeRef,
} from 'spinal-env-viewer-graph-service';
import { spinalAnalyticService } from 'spinal-model-analysis';

import * as ejs from 'ejs';
import * as path from 'path';
import * as fs from 'fs';
import { performance } from 'perf_hooks';


require('dotenv').config();

class SpinalMain {
  constructor() {}

  private handledAnalytics : string[];
  private durations : number[];

  public init() {
    this.handledAnalytics = [];
    this.durations = [];

    console.log('Init connection to HUB...');
    const url = `${process.env.SPINALHUB_PROTOCOL}://${process.env.USER_ID}:${process.env.USER_PASSWORD}@${process.env.SPINALHUB_IP}:${process.env.SPINALHUB_PORT}/`;
    const conn = spinalCore.connect(url);
    ConfigFile.init(conn, process.env.ORGAN_NAME + "-config", process.env.SPINALHUB_IP, process.env.SPINALHUB_PROTOCOL, parseInt(process.env.SPINALHUB_PORT));
    return new Promise((resolve, reject) => {
      spinalCore.load(
        conn,
        process.env.DIGITALTWIN_PATH,
        async (graph: any) => {
          await SpinalGraphService.setGraph(graph);
          console.log('Connection successfull !');
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


  private async handleAnalytic(analytic: SpinalNodeRef) {
    const config = await spinalAnalyticService.getConfig(analytic.id.get());
    if (config.intervalTime.get() === '0' || config.intervalTime.get() === 0) {
      const entities = await spinalAnalyticService.getWorkingFollowedEntities(
        analytic.id.get()
      );
      for (const entity of entities) {
        const entryDataModels =
          await spinalAnalyticService.getEntryDataModelsFromFollowedEntity(
            analytic.id.get(),
            entity
          );
        for (const entryDataModel of entryDataModels) {
          const valueModel = await entryDataModel.element.load();
          valueModel.bind(() => {
            const startTime = performance.now();
            console.log('Value changed, starting analysis...');
            spinalAnalyticService.doAnalysis(analytic.id.get(), entity).then(() => {
              const endTime = performance.now();
              const elapsedTime = endTime - startTime;
              console.log(`Analysis completed in ${elapsedTime.toFixed(2)}ms`);
              this.durations.push(elapsedTime);
            
            });
              
          }, false);
        }
      }
    } else {
      const entities = await spinalAnalyticService.getWorkingFollowedEntities(
        analytic.id.get()
      );
      for (const entity of entities) {
        setInterval( async () => {
          const startTime = performance.now();
          spinalAnalyticService.doAnalysis(analytic.id.get(), entity);
          const endTime = performance.now();
          const elapsedTime = endTime - startTime;
          console.log(`Analysis completed in ${elapsedTime.toFixed(2)}ms`);
          this.durations.push(elapsedTime);
        }, config.intervalTime.get());
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
        if (this.handledAnalytics.includes(analytic.id.get())) {
          // Analytic already handled so skip
          continue;
        }
        console.log('Handling Analytic : ', analytic.name.get());
        // si intervalTime = 0 => method COV
        this.handleAnalytic(analytic);
        this.handledAnalytics.push(analytic.id.get());
      }
    }
  }

  private getAverageDuration(){
    return this.durations.reduce((sum, curr) => sum + curr, 0) / this.durations.length;
  }



  public generateReport(){
    ejs.renderFile(
      path.join(__dirname, '../templates/report.ejs'),
      { totalAnalyses: this.handledAnalytics.length, averageDuration: this.getAverageDuration(), durations: this.durations },
      (err, html) => {
        if (err) {
          console.error('Error rendering report:', err);
        } else {
          fs.writeFileSync('report.html', html);
          console.log('Report generated successfully!');
        }
      }
    );
  }

  public resetReportVariables(){
    this.durations=[];
  }




}

async function Main() {
  const spinalMain = new SpinalMain();
  await spinalMain.init();

  //await spinalMain.initContext();

  await spinalMain.initJob();

  setInterval(async () => {
    await spinalMain.initJob();
  }, parseInt(process.env.UPDATE_ANALYTIC_QUEUE_TIMER));


  setInterval(() => {
    spinalMain.generateReport();
    spinalMain.resetReportVariables();
  }, parseInt(process.env.REPORT_TIMER));

  
}
Main();
