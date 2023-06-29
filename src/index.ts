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
} from 'spinal-core-connectorjs_type';
import {
  SpinalGraphService,
  SpinalContext,
  SpinalNodeRef,
} from 'spinal-env-viewer-graph-service';
import {
  spinalAnalyticService,
  CATEGORY_ATTRIBUTE_ALGORTHM_PARAMETERS,
} from 'spinal-model-analysis';

import * as ejs from 'ejs';
import * as path from 'path';
import * as fs from 'fs';
import puppeteer from 'puppeteer';
import os from 'os';
import { performance } from 'perf_hooks';
import { debounce } from 'lodash';
import { google } from 'googleapis';
import { JWT } from 'google-auth-library';
import moment from 'moment';
require('dotenv').config();

const chat = google.chat('v1');

class SpinalMain {
  constructor() {}

  private handledAnalytics: string[];
  private durations: number[];
  jwtClient: JWT;

  public init() {
    this.handledAnalytics = [];
    this.durations = [];

    console.log('Init connection to Google Services...');
    this.jwtClient = new JWT({
      email: process.env.GSERVICE_ACCOUNT_EMAIL,
      key: process.env.GSERVICE_ACCOUNT_KEY,
      scopes: [
        'https://www.googleapis.com/auth/chat.bot',
        'https://www.googleapis.com/auth/chat.messages',
        'https://www.googleapis.com/auth/chat.messages.create',
      ],
    });
    google.options({ auth: this.jwtClient });
    console.log('Done.');
    console.log('Init connection to HUB...');
    const url = `${process.env.SPINALHUB_PROTOCOL}://${process.env.USER_ID}:${process.env.USER_PASSWORD}@${process.env.SPINALHUB_IP}:${process.env.SPINALHUB_PORT}/`;
    const conn = spinalCore.connect(url);
    ConfigFile.init(
      conn,
      process.env.ORGAN_NAME + '-config',
      process.env.SPINALHUB_IP,
      process.env.SPINALHUB_PROTOCOL,
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

  private async handleAnalytic(analytic: SpinalNodeRef) {
    const config = await spinalAnalyticService.getConfig(analytic.id.get());
    const configParams = await spinalAnalyticService.getAttributesFromNode(
      config.id.get(),
      CATEGORY_ATTRIBUTE_ALGORTHM_PARAMETERS
    );

    // Create debouncedAnalysis function here to avoid code duplication
    const debouncedAnalysis = debounce((id, entity) => {
      const startTime = performance.now();
      spinalAnalyticService.doAnalysis(id, entity).then(() => {
        const endTime = performance.now();
        const elapsedTime = endTime - startTime;
        console.log(`Analysis completed in ${elapsedTime.toFixed(2)}ms`);
        this.durations.push(elapsedTime);
      });
    }, 500); // 500ms delay

    const entities = await spinalAnalyticService.getWorkingFollowedEntities(
      analytic.id.get()
    );

    // Run the async operations inside the loop in parallel
    await Promise.all(
      entities.map(async (entity) => {
        if (
          configParams['intervalTime'] === '0' ||
          configParams['intervalTime'] === 0
        ) {
          const entryDataModels =
            await spinalAnalyticService.getEntryDataModelsFromFollowedEntity(
              analytic.id.get(),
              entity,
              true,
              false
            );
          await Promise.all(
            entryDataModels.map(async (entryDataModel) => {
              const valueModel = await entryDataModel.element.load();
              let previousValue = valueModel.currentValue.get(); // store the previous value
              if (configParams['triggerAtStart']) {
                console.log('Trigger at start is true, forcing analysis...');
                previousValue = null; // if triggerAtStart is true, force the analysis to run at the start
              }
              console.log(
                'ValueModel current value : ',
                valueModel.currentValue.get()
              );
              valueModel.currentValue.bind(() => {
                if (valueModel.currentValue.get() === previousValue) {
                  console.log('Value not changed, skipping analysis...');
                } else {
                  previousValue = valueModel.currentValue.get();
                  console.log('Value changed, starting analysis...');
                  debouncedAnalysis(analytic.id.get(), entity);
                }
              }, false);
            })
          );
        } else {
          if (configParams['triggerAtStart']) {
            debouncedAnalysis(analytic.id.get(), entity);
          }
          setInterval(() => {
            debouncedAnalysis(analytic.id.get(), entity);
          }, configParams['intervalTime']);
        }
      })
    );
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
        this.handleAnalytic(analytic);
        this.handledAnalytics.push(analytic.id.get());
      }
    }
  }

  private getAverageDuration() {
    return (
      this.durations.reduce((sum, curr) => sum + curr, 0) /
      this.durations.length
    );
  }

  public generateReport() {
    const formatMemoryUsage = (data) =>
      `${Math.round((data / 1024 / 1024) * 100) / 100} MB`;
    const memoryData = process.memoryUsage();
    const memoryUsage = {
      rss: `${formatMemoryUsage(memoryData.rss)}`,
      heapTotal: `${formatMemoryUsage(memoryData.heapTotal)}`,
      heapUsed: `${formatMemoryUsage(memoryData.heapUsed)}`,
      external: `${formatMemoryUsage(memoryData.external)}`,
    };
    const totalMemory = os.totalmem();
    const freeMemory = os.freemem();
    const usedMemory = totalMemory - freeMemory;
    const memoryUsagePercentage = Math.round((usedMemory / totalMemory) * 100);
    const cpuUsagePercentage = Math.round(os.loadavg()[2]);

    ejs.renderFile(
      path.join(__dirname, '../templates/report.ejs'),
      {
        totalAnalyses: this.handledAnalytics.length,
        averageDuration: this.getAverageDuration(),
        durations: this.durations,
      },
      async (err, html) => {
        if (err) {
          console.error('Error rendering report:', err);
        } else {
          const browser = await puppeteer.launch();
          const page = await browser.newPage();
          await page.setContent(html);
          await page.pdf({ path: 'report.pdf', format: 'A4' });
          await browser.close();
          console.log('Report generated successfully!');
        }
      }
    );

    try {
      const generatedDate = moment().format('MMMM Do YYYY, h:mm:ss a');
      if (this.jwtClient) {
        console.log('Sending report to Google Chat...');
        chat.spaces.messages.create({
          parent: `spaces/${process.env.GSPACE_NAME}`,
          requestBody: {
            cards: [
              {
                header: {
                  title: 'Report',
                  subtitle: `Generated from ${process.env.ORGAN_NAME} at ${generatedDate}`,
                },
                sections: [
                  {
                    header: 'Global Memory Information',
                    widgets: [
                      {
                        keyValue: {
                          topLabel: 'Total Memory',
                          content: `${formatMemoryUsage(totalMemory)}`,
                          bottomLabel: 'Total memory of the system',
                        },
                      },
                      {
                        keyValue: {
                          topLabel: 'Free Memory',
                          content: `${formatMemoryUsage(freeMemory)}`,
                          bottomLabel: 'Free memory of the system',
                        },
                      },
                      {
                        keyValue: {
                          topLabel: 'Used Memory',
                          content: `${formatMemoryUsage(usedMemory)}`,
                          bottomLabel: 'Used memory of the system',
                        },
                      },
                      {
                        keyValue: {
                          topLabel: 'Memory Usage',
                          content: `${memoryUsagePercentage}%`,
                          bottomLabel: 'Percentage of memory used',
                        },
                      },
                      {
                        keyValue: {
                          topLabel: 'Average CPU Usage (15 minutes)',
                          content: `${cpuUsagePercentage}%`,
                          bottomLabel:
                            'Average percentage of CPU used the last 15 minutes',
                        },
                      },
                    ],
                  },
                  {
                    header: 'Organ Process Memory Information',
                    widgets: [
                      {
                        keyValue: {
                          topLabel: 'Resident Set Size',
                          content: memoryUsage.rss,
                          bottomLabel:
                            'Total memory allocated for the process execution',
                        },
                      },
                      {
                        keyValue: {
                          topLabel: 'Heap Total',
                          content: memoryUsage.heapTotal,
                          bottomLabel: 'Total size of the allocated heap',
                        },
                      },
                      {
                        keyValue: {
                          topLabel: 'Heap Used',
                          content: memoryUsage.heapUsed,
                          bottomLabel: 'Actual memory used during the execution',
                        },
                      },
                      {
                        keyValue: {
                          topLabel: 'External',
                          content: memoryUsage.external,
                          bottomLabel: 'V8 external memory',
                        },
                      },
                    ],
                  },
                  {
                    header: 'Organ Specific Information ',
                    widgets: [
                      {
                        keyValue: {
                          topLabel: 'Total Analyses',
                          content: `${this.handledAnalytics.length}`,
                          bottomLabel:
                            'Total number of analyses since last report',
                        },
                      },
                      {
                        keyValue: {
                          topLabel: 'Average Duration',
                          content: `${this.getAverageDuration().toFixed(2)}ms`,
                          bottomLabel: 'Average duration of an analysis',
                        },
                      },
                    ],
                  },
                ],
              },
            ],
          },
        });
      } else {
        console.log(
          'No Google Chat credentials found, skipping report sending...'
        );
      }
      } catch (e) {
        console.error('Error sending chat report:', e);
      }
  }

  public resetReportVariables() {
    this.durations = [];
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
  }, parseInt(process.env.UPDATE_ANALYTIC_QUEUE_TIMER));

  setInterval(() => {
    spinalMain.generateReport();
    spinalMain.resetReportVariables();
  }, parseInt(process.env.REPORT_TIMER));
}
Main();
