export const AUTONOMOUS_CLASSES:Readonly<Record<string,string>>;
export const VERDICTS:readonly string[];
export const VET_RULES:Readonly<{minAutonomy:number;maxHours:number;maxDeliveryDays:number;maxBidUsd:number;freshHours:number}>;
export function validateVet(value:unknown):Record<string,unknown>;
export function vetAllowsBid(vet:unknown,now?:number):boolean;
export function vetIsAutonomous(vet:unknown):boolean;
