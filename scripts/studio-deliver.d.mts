export function openDeliveries(options?:{now?:number;log?:(m:string)=>void}):Promise<{opened:string[]}>;
export function listDeliveries(now?:number):{id:number;title:string;status:string;priceUsd:number;dueAt:string;hoursLeft:number;unreadClientMessages:number;deliveries:number;workspace:string;lastEvent:{at:string;kind:string;detail:string}|null}[];
export function readDeliveries():{version:number;deliveries:Record<string,Record<string,unknown>>;receipts:Record<string,unknown>[]};
