import type { SpinalNode } from 'spinal-env-viewer-graph-service';
export interface CovTriggerRef {
    id?: string;
    inputRegister?: string;
}
export interface CovBindingRef {
    workNode: SpinalNode<any>;
    triggerId?: string;
    inputRegister: string;
}
export declare function covBindingKey(workNode: SpinalNode<any>, trigger: CovTriggerRef): string;
export declare function planCOVRefresh<B extends CovBindingRef>(bindings: B[], workNodes: SpinalNode<any>[], covTriggers: CovTriggerRef[]): {
    keep: B[];
    drop: B[];
    toBind: SpinalNode<any>[];
};
export declare function modelSnapshot(model: {
    get?: () => unknown;
}): unknown;
