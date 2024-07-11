declare module '@aspectron/flow-async'{
	export function dpc(delay:number, fn:Function):number;
	export function clearDPC(id:number);
}