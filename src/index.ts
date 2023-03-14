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
                if (config.intervalTime.get() === 0){
                    const entities = await spinalAnalyticService.getWorkingFollowedEntities(analytic.id.get());
                    console.log("entities",entities, " of analytic ", analytic.name.get());
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
                // si intervalTime = 0 => method COV
                this.handleAnalytic(analytic);
            }
        }
    }

    /*public async initJob(){
        const contexts = spinalAnalyticService.getContexts();
        for (const context of contexts){
            const analytics = await spinalAnalyticService.getAllAnalytics(context.id.get());
            for (const analytic of analytics){
                const entryDataModels = await spinalAnalyticService.applyTrackingMethodLegacy(analytic.id.get());
                for (const entryDataModel of entryDataModels){
                    const valueModel = (await entryDataModel.element.load());
                    valueModel.bind(
                        () => {
                            console.log("Value changed, starting analysis...");
                            spinalAnalyticService.doAnalysis(analytic.id.get());
                        },false
                    )
                    
                }
                
                //await spinalAnalyticService.doAnalysis(completeAnalysisModel);
            }
        }

    }*/

    /*public async initJob(){
        // console.log(serviceAnalysis);
        console.log("////////////////////////////////////////   DEBUT ANALYSE : " +new Date(Date.now())+     "       ////////////////////////////////////////");
        
        let contexts = await serviceAnalysis.getContext();
        for(let context of contexts){
            let analysisProcesses = await serviceAnalysis.getAllAnalysisProcesses(context.getId());
            for(let analysisProcess of analysisProcesses){
                let completeAnalysisModel = await serviceAnalysis.getCompleteAnalysis(context.getId(), analysisProcess.id.get());
                // console.log(completeAnalysisModel);
                await serviceAnalysis.launchCompleteAnalysis(completeAnalysisModel);
            }
        }
        console.log("////////////////////////////////////////   FIN ANALYSE : " +new Date(Date.now())+     "     ////////////////////////////////////////");
    }

    public async job(){
        let workflows = SpinalGraphService.getContextWithType("SpinalSystemServiceTicket");
        for(let workflow of workflows){
            if(workflow.info.subType != undefined){
                if(workflow.info.subType.get() == "Alarm"){
                    let processes = await serviceTicketPersonalized.getAllProcess(workflow.info.id.get());
                    for(let pro of processes){
                        let analysisProcess = await this.getAnalysisProcess(pro.id.get(), workflow.info.id.get());
                        console.log(" ////////////// JOB ///////////// ");
                        console.log(analysisProcess);
                        console.log(" ////////////// END JOB ////////////");
                        // await this.launchAnalysisProcess(analysisProcess);
                    }
                }
            }
        }
    }

    public async getAnalysisProcess(parentId:string, contextId: string):Promise<any>{
        let returnObj = {
            processId: parentId,
            contextId: contextId,
            analysisName: "",
            analysisResult: "",
            entityId: "",
            entityType: "",
            analysisProcess:{
                name: "",
                config: []
            }
        };

        let analysis = await SpinalGraphService.getChildren(parentId, ["hasAnalysisProcess"]);
        console.log(analysis);
        if(analysis.length !=0){
            returnObj.analysisName = analysis[0].name.get();
            // returnObj.analysisResult = analysis[0].result.get();
            returnObj.analysisResult = "Ticket";
            console.log(analysis[0].id.get());
            let entity = await SpinalGraphService.getChildren(analysis[0].id.get(), ["hasFollowedEntity"]);
            console.log(entity)
            
            if(entity.length !=0){
                returnObj.entityId = entity[0].id.get();
                returnObj.entityType = entity[0].type.get();
            }
            let analysisProcess = await SpinalGraphService.getChildren(analysis[0].id.get(), ["hasAnalytic"]);
            if(analysisProcess.length !=0){
                returnObj.analysisProcess.name = analysisProcess[0].name.get();
                let analysisProcessNode = SpinalGraphService.getRealNode(analysisProcess[0].id.get());
                (<any>SpinalGraphService)._addNode(analysisProcessNode);
                let attributes = await attributeService.getAllAttributes(analysisProcessNode);
                if(attributes.length !=0){
                    for(let attr of attributes){
                        returnObj.analysisProcess.config.push({
                            name: attr.label.get(),
                            type: attr.type.get(),
                            value: attr.value.get()
                        });
                    }
                }
            }
        }
        return returnObj;
    }

    public async launchAnalysisProcess(process):Promise<any>{
        
        let tickets = [];
        let typeSplitted = process.entityType.split("Group");
        let relationName = ["groupHas" + typeSplitted[0]];
        let children = await SpinalGraphService.getChildren(process.entityId, relationName);

        for(let child of children){
            if(process.analysisProcess.name == "THRESHOLD_BETWEEN"){
                let seuil1 = parseInt(process.analysisProcess.config[0].value);
                let seuil2 = parseInt(process.analysisProcess.config[1].value);

                let cp = await this.findControlPoint(child.id.get(), "Temperature moyenne");
                if(cp != undefined){
                    let cpNode = SpinalGraphService.getRealNode(cp.id.get());
                    (<any>SpinalGraphService)._addNode(cpNode);
                    let currentValue = await attributeService.findOneAttributeInCategory(cpNode, "default", "currentValue");
                    if(currentValue != -1){
                        
                        let val = currentValue.value.get();
                        if(val < seuil1 || val >seuil2){
                            console.log(currentValue.value.get() + " °C");
                            let ticketInfos = {
                                name: process.analysisName + " : " + child.name.get(),
                                // stepId: "SpinalNode-743bcc70-9194-6d44-8c5d-94ee7bb549e4-180d6f8d6ee",
                                processId: process.processId
                            }
                            let ticket = await serviceTicketPersonalized.addTicket(ticketInfos, process.processId, process.contextId, child.id.get());
                            tickets.push(ticket);
                            
                            console.log("1 : " + child.name.get());                  
                        }
                    }
                    else{
                        console.log("currentValue not found, do smth !")
                    }
                }
            }
        }
        console.log(tickets);
    }

    public async findControlPoint(parentId, name){
        let controlPoints = await SpinalGraphService.getChildren(parentId, ["hasControlPoints"]);
        if(controlPoints.length !=0){
            for(let cp of controlPoints){
                let bmsEndpoints = await SpinalGraphService.getChildren(cp.id.get(), ["hasBmsEndpoint"]);
                if(bmsEndpoints.length !=0){
                    for(let bms of bmsEndpoints){
                        if(bms.name.get() == name){
                            return bms;
                        }
                    }
                }
            }
        }
        return undefined;
    }*/
}

async function Main(){
    const spinalMain = new SpinalMain();
    await spinalMain.init();
    await spinalMain.initContext();
    //await spinalMain.createTestEnvironment2();
    await spinalMain.initJob();
    /*
    // await spinalMain.job();
    spinalMain.initJob();
    setInterval(()=> {
        /////////////////// DEBUT ///////////////////////
        spinalMain.initJob();
        ///////////////////  FIN  ///////////////////////
}, 150000) // 300000 = 5mn
    // await spinalMain.initJob();
    */
}
Main();

