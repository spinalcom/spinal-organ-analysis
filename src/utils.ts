import { AnalysisExecutionResult, WorkNodeExecutionResult } from "spinal-model-analysis";
import {
    SpinalGraphService,
    SpinalContext,
    SpinalNodeRef,
    SpinalNode
} from 'spinal-env-viewer-graph-service';



export function isSpinalNodeArray(nodes: any): boolean {
    return Array.isArray(nodes) && nodes.every(node => node.getName && typeof node.getName === 'function');
}



export function logExecutionResult(result: AnalysisExecutionResult) {
    for (const res of result.results) {
        console.log(` ---- WORKNODE ${res.workNodeName} OUTPUTS ---- `);
        for (const outputKey of Object.keys(res.executionOutputs!)) {
            let output: any;
            if (res.executionOutputs![outputKey] instanceof SpinalNode) {
                const node: SpinalNode = res.executionOutputs![outputKey] as SpinalNode;
                output = `NODE[${node?.getName()?.get()}]`;
            }
            else if (isSpinalNodeArray(res.executionOutputs![outputKey])) {
                output = (res.executionOutputs![outputKey] as SpinalNode[]).map((node: SpinalNode) => `NODE[${node?.getName()?.get()}]`);
            }
            else {
                output = res.executionOutputs![outputKey];
            }

            console.log(`Output ${outputKey}:`, output);
        }
    }
}