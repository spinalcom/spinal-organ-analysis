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


import config from './config';
import { Process, spinalCore , FileSystem } from "spinal-core-connectorjs_type";
import { serviceTicketPersonalized, spinalServiceTicket } from "spinal-service-ticket";
import { SpinalGraphService, SpinalContext, SpinalNodeRef } from "spinal-env-viewer-graph-service";
import { attributeService } from 'spinal-env-viewer-plugin-documentation-service';
import { 
    spinalAnalyticService,
    IAnalytic,
    IEntity,
    IConfig,
    ITrackingMethod,
    ENTITY_TYPES,
    ALGORITHMS,
    ANALYTIC_RESULT_TYPE,
    TRACK_METHOD
} from 'spinal-model-analysis';

//import { serviceAnalysis } from 'spinal-service-analysis';

class SpinalMain {
    constructor() {}

    private handledAnalytics = [];

    public init() {
        this.handledAnalytics = [];
        console.log("Init connection to HUB...");
        const url = `http://${config.userId}:${config.userPassword}@${config.hubHost}:${config.hubPort}/`;
        
        return new Promise((resolve, reject) => {
            spinalCore.load(spinalCore.connect(url), config.digitalTwinPath, async (graph: any) => {
                await SpinalGraphService.setGraph(graph);
                console.log("Connection successfull !");
                resolve(graph)
            }, () => {
                console.log("Connection failed ! Please check your config file and the state of the hub.");
                reject()
            })
        });
    }
    public async getSpinalGeo(): Promise<SpinalContext<any>> {
        const context = SpinalGraphService.getContext("spatial");
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

    


    public async createTestEnvironment() {
        const context = await spinalAnalyticService.createContext("testContext");
        const IEntityInfo : IEntity = {
            name: "Pièces",
            standard_name: "Rooms",
            entityType: ENTITY_TYPES.ROOM,
            description:""
        };
        const IAnalytic: IAnalytic = {
            name: "Température anormale",
            description :""
        };

        const IConfig : IConfig = {
            algorithm: ALGORITHMS.THRESHOLD_ABOVE,
            resultType: ANALYTIC_RESULT_TYPE.TICKET,
            resultName:"Température anormale",
            intervalTime: 0

        };
        const algorithmParameters = [
            { name: "p1" , value: 15 , type: "number"},
        ];
        const ITrackingMethod : ITrackingMethod = {
            name: "TrackingMethod",
            trackMethod: TRACK_METHOD.CONTROL_ENDPOINT_NAME_FILTER,
            filterValue: "Température"
        }

        const entityInfo = await spinalAnalyticService.addEntity(IEntityInfo,context.id.get());
        const analyticInfo = await spinalAnalyticService.addAnalytic(IAnalytic,context.id.get(),entityInfo.id.get());
        const trackingMethodInfo = await spinalAnalyticService.addInputTrackingMethod(ITrackingMethod,context.id.get(),analyticInfo.id.get());
        const configInfo = await spinalAnalyticService.addConfig(IConfig,algorithmParameters,analyticInfo.id.get(),context.id.get());
        /*const followedEntityInfo = await spinalAnalyticService.addInputLinkToFollowedEntity(context.id.get(),
        analyticInfo.id.get(),"SpinalNode-69e8c850-4d04-ace6-7db2-3e3bf4e4d944-1825e3c67cc");
        */

        // groupe de salles ou étage
        const followedEntityInfo = await spinalAnalyticService.addInputLinkToFollowedEntity(context.id.get(),
        analyticInfo.id.get(),"SpinalNode-277d9c8d-efa0-8cba-7fa5-3632cb307207-1825e3c98c3");


    }

    public async createTestEnvironment2() {
        const context = await spinalAnalyticService.createContext("testContext");
        const IEntityInfo : IEntity = {
            name: "Pièces",
            standard_name: "Rooms",
            entityType: ENTITY_TYPES.ROOM,
            description:""
        };
        const IAnalytic: IAnalytic = {
            name: "Régulation de la température",
            description :""
        };

        const IConfig : IConfig = {
            algorithm: ALGORITHMS.PUTVALUE,
            resultType: ANALYTIC_RESULT_TYPE.MODIFY_CONTROL_ENDPOINT,
            resultName:"Régulation de la température",
            intervalTime: 0

        };
        const algorithmParameters = [
            { name: "p1" , value: 22 , type: "number"},
        ];
        const ITrackingMethod : ITrackingMethod = {
            name: "TrackingMethod",
            trackMethod: TRACK_METHOD.CONTROL_ENDPOINT_NAME_FILTER,
            filterValue: "Température"
        }

        const entityInfo = await spinalAnalyticService.addEntity(IEntityInfo,context.id.get());
        const analyticInfo = await spinalAnalyticService.addAnalytic(IAnalytic,context.id.get(),entityInfo.id.get());
        const trackingMethodInfo = await spinalAnalyticService.addInputTrackingMethod(ITrackingMethod,context.id.get(),analyticInfo.id.get());
        const configInfo = await spinalAnalyticService.addConfig(IConfig,algorithmParameters,analyticInfo.id.get(),context.id.get());
        /*const followedEntityInfo = await spinalAnalyticService.addInputLinkToFollowedEntity(context.id.get(),
        analyticInfo.id.get(),"SpinalNode-69e8c850-4d04-ace6-7db2-3e3bf4e4d944-1825e3c67cc");
        */

        // groupe de salles ou étage
        const followedEntityInfo = await spinalAnalyticService.addInputLinkToFollowedEntity(context.id.get(),
        analyticInfo.id.get(),"SpinalNode-277d9c8d-efa0-8cba-7fa5-3632cb307207-1825e3c98c3");

    }

    private async handleAnalytic(analytic : SpinalNodeRef) {
        const config = await spinalAnalyticService.getConfig(analytic.id.get());
                console.log(config.intervalTime.get());
                if (config.intervalTime.get() === '0' || config.intervalTime.get() === 0){
                    const entities = await spinalAnalyticService.getWorkingFollowedEntities(analytic.id.get());
                    for (const entity of entities){
                        const entryDataModels = await spinalAnalyticService.getEntryDataModelsFromFollowedEntity(analytic.id.get(),entity);
                        for (const entryDataModel of entryDataModels){
                            const valueModel = (await entryDataModel.element.load());
                            valueModel.bind(
                                () => {
                                    console.log("Value changed, starting analysis...");
                                    spinalAnalyticService.doAnalysis(analytic.id.get(),entity);
                                },false
                            )
                        }
                    }
                }
                else {
                    const entities = await spinalAnalyticService.getWorkingFollowedEntities(analytic.id.get());
                    for (const entity of entities){
                        setInterval(() => {
                            spinalAnalyticService.doAnalysis(analytic.id.get(),entity);
                        },config.intervalTime.get())
                    }
                }
    }
    
    public async initJob(){
        const contexts = spinalAnalyticService.getContexts();
        for (const context of contexts){
            const analytics = await spinalAnalyticService.getAllAnalytics(context.id.get());
            for (const analytic of analytics){
                console.log("Handling Analytic : ",analytic.name.get());
                if(this.handledAnalytics.includes(analytic.id.get())){
                    continue;
                } 
                // si intervalTime = 0 => method COV
                this.handleAnalytic(analytic);
                this.handledAnalytics.push(analytic.id.get());
            }
        }
    }
}

async function Main(){
    const spinalMain = new SpinalMain();
    await spinalMain.init();
    await spinalMain.initContext();

    await spinalMain.initJob();

    const timer = parseInt(process.env.UPDATE_ANALYTIC_QUEUE_TIMER)
    setInterval(async () =>{
        await spinalMain.initJob();
    }, timer);

}
Main();

