import * as fs from 'fs';
import * as path from 'path';
import { EventEmitter } from 'events';
import { dpc, clearDPC } from '@aspectron/flow-async';
import * as gRPC from '@grpc/grpc-js';
import * as protoLoader from '@grpc/proto-loader';
import {
	PendingReqs, IData, IStream, QueueItem, MessagesProto,
	ServiceClientConstructor, PugdagPackage, SubscriberItem, SubscriberItemMap,
	RPC as Rpc
} from '../types/custom-types';
import { resolve } from 'path';

 
export class Client {
	stream:IStream;
	options:any;
	pending:PendingReqs;
	intakeHandler:Function|undefined;
	reconnect:boolean = true;
	client:any|undefined;
	reconnect_dpc:number|undefined;
	verbose:boolean = false;
	log:Function;
	proto:PugdagPackage|undefined;
	subscribers: SubscriberItemMap = new Map();
	isConnected:boolean=false;
	connectCBs:Function[] = [];
	connectFailureCBs:Function[] = [];
	errorCBs:Function[] = [];
	disconnectCBs:Function[] = [];
	connectionPhase:boolean;
	disableConnectionCheck:boolean;

	constructor(options:any) {
		this.options = Object.assign({
			protoPath: __dirname + '/../../proto/messages.proto',
			host: 'localhost:42210',
			reconnect: true,
			verbose : false,
			uid:(Math.random()*1000).toFixed(0),
		}, options||{});
		this.pending = { };
		this.log = Function.prototype.bind.call(
			console.log,
			console,
			`[Pugdag gRPC ${this.options.uid}]:`
		);
		this.reconnect = this.options.reconnect;
		this.verbose = this.options.verbose;
		this.connectionPhase = false;
		this.disableConnectionCheck = options.disableConnectionCheck || false;
		// console.log(this);
	}

	getServiceClient():ServiceClientConstructor {
		const {protoPath} = this.options;
		const packageDefinition = protoLoader.loadSync(protoPath, {
			keepCase: true,
			longs: String,
			enums: String,
			defaults: true,
			oneofs: true
		});

		const proto:MessagesProto = <MessagesProto>gRPC.loadPackageDefinition(packageDefinition);
		this.proto = proto.protowire;
		const {P2P, RPC} = proto.protowire;
		return RPC;
	}
	connect(){
		this.reconnect = true;
		return this._connect();
	}

	async _connect() {
		// console.trace("gRPC connection phase...");
		this.verbose && this.log('gRPC Client connecting to', this.options.host);
		if(!this.client){
			const RPC = this.getServiceClient();
			this.client = new RPC(this.options.host, gRPC.credentials.createInsecure(),
				{ 
					// "grpc.keepalive_timeout_ms": 25000 
					"grpc.max_receive_message_length": -1
				}
			);
		}else{
			// console.log("WARNING: multiple gRPC connection phases!");
			return new Promise((resolve) => {
				this.onConnect(resolve);
			})
		}

		await this._connectClient();
	}
	_reconnect(reason:string){
		this._setConnected(false);
		if(this.reconnect_dpc) {
			clearDPC(this.reconnect_dpc);
			delete this.reconnect_dpc;
		}

		this.clearPending(reason);
		delete this.stream;
		//delete this.client;
		if(this.reconnect) {
			this.reconnect_dpc = dpc(1000, () => {
				this._connectClient();
			})
		}
	}
	async _connectClient(){
		this.client.waitForReady(2500, (connect_error:any)=>{
			
			if(connect_error){
				//console.log("connect_error")
				//this.connectionPhase = false;
				this._reconnect('client connect deadline reached');
				return resolve();
			}

			console.log("client connected")

			this.stream = this.createStream();
			this.initIntake(this.stream);
			
			this.stream.on('error', (error:any) => {
				// console.log("client:",error);
				this.errorCBs.forEach(fn=>fn(error.toString(), error));
				this.verbose && this.log('stream:error', error);
				this._reconnect(error);
			})
			this.stream.on('end', (...args:any) => {
				this.verbose && this.log('stream:end', ...args);
				this._reconnect('stream end');
			});

			if(this.disableConnectionCheck)
				return resolve();
			
			dpc(100, async()=>{
				let response:any = await this.call('getVirtualSelectedParentBlueScoreRequest', {})
				.catch(e=>{
					this.connectFailureCBs.forEach(fn=>fn(e));
				})
				this.verbose && this.log("getVirtualSelectedParentBlueScoreRequest:response", response)
				if(response && response.blueScore){
					this._setConnected(true);
				}
				resolve();
			})
		})
	}

	_setConnected(isConnected:boolean){
		if(this.isConnected == isConnected)
			return;
		this.isConnected = isConnected;

		let cbs = isConnected?this.connectCBs:this.disconnectCBs;
		//console.log("this.isConnected", this.isConnected, cbs)
		cbs.forEach(fn=>{
			fn();
		})
	}

	onConnect(callback:Function){
		this.connectCBs.push(callback)
		if(this.isConnected)
			callback();
	}
	onConnectFailure(callback:Function){
		this.connectFailureCBs.push(callback)
	}
	onError(callback:Function){
		this.errorCBs.push(callback)
	}
	onDisconnect(callback:Function){
		this.disconnectCBs.push(callback)
	}

	disconnect() {
		if(this.reconnect_dpc) {
			clearDPC(this.reconnect_dpc);
			delete this.reconnect_dpc;
		}
		this.reconnect = false;
		this.stream && this.stream.end();
		this.clearPending();
	}

	clearPending(reason?:string) {
		Object.keys(this.pending).forEach(key => {
			let list = this.pending[key];
			list.forEach(o=>o.reject(reason||'closing by force'));
			this.pending[key] = [];
		});
	}

	close() {
		this.disconnect()
	}

	createStream() {
		if(!this.client)
			return null;
		const stream = this.client.MessageStream(()=>{
		});
		//console.log("stream", stream)
		return stream;
	}

	initIntake(stream:IStream) {
		stream.on('data', (data:any) => {
			//this.log("stream:data", data)
			if(data.payload) {
				let name = data.payload;
				let payload = data[name];
				let ident = name.replace(/^get|Response$/ig,'').toLowerCase();
				this.handleIntake({name, payload, ident });
			}
		});
	}

	handleIntake(o:IData) {
		if(this.intakeHandler) {
			this.intakeHandler(o);
		} else {
			let handlers = this.pending[o.name];
			this.verbose && console.log('intake:',o,'handlers:',handlers);
			//if(o.name == 'getUtxosByAddressesResponse'){
			//	console.log(JSON.stringify(o, null, "  "));
			//}
			if(handlers && handlers.length){
				let pending:QueueItem|undefined = handlers.shift();
				if(pending)
					pending.resolve(o.payload);
			}

			let subscribers:SubscriberItem[]|undefined = this.subscribers.get(o.name);
			//this.log("handleIntake:o.name:", o.name, subscribers)
			if(subscribers){
				subscribers.map(subscriber=>{
					subscriber.callback(o.payload)
				})
			}
		}
	}

	setIntakeHandler(fn:Function) {
		this.intakeHandler = fn;
	}

	post(name:string, args:any={ }) {
		if(!this.stream)
			return false;

		let req = {
			[name]:args
		}
		this.verbose && this.log('post:',req);
		this.stream.write(req);

		return true;
	}

	call(method:string, data:any) {
		this.verbose && this.log('call to', method);
		if(!this.client)
			return Promise.reject('not connected');

		return new Promise((resolve, reject) => {
			let stream = this.stream;
			if(!stream) {
				this.verbose &&  this.log('could not create stream');
				return reject('not connected');
			}

			const resp = method.replace(/Request$/,'Response');
			if(!this.pending[resp])
				this.pending[resp] = [];
			let handlers:QueueItem[] = this.pending[resp];
			handlers.push({method, data, resolve, reject});

			this.post(method, data);
		})
	}

	subscribe<T>(subject:string, data:any={}, callback:Function):Rpc.SubPromise<T>{
		if(typeof data == 'function'){
			callback = data;
			data = {};
		}

		this.verbose && this.log('subscribe to', subject);
		if(!this.client)
			return Promise.reject('not connected') as Rpc.SubPromise<T>;

		let eventName = this.subject2EventName(subject);
		this.verbose && this.log("subscribe:eventName", eventName)

		let subscribers:SubscriberItem[]|undefined = this.subscribers.get(eventName);
		if(!subscribers){
			subscribers = [];
			this.subscribers.set(eventName, subscribers);
		}
		let uid = (Math.random()*100000 + Date.now()).toFixed(0);
		subscribers.push({uid, callback});

		let p = this.call(subject, data) as Rpc.SubPromise<T>;

		p.uid = uid;
		return p;
	}

	subject2EventName(subject:string){
		let eventName = subject.replace("notify", "").replace("Request", "Notification")
		return eventName[0].toLowerCase()+eventName.substr(1);
	}

	unSubscribe(subject:string, uid:string=''){
		let eventName = this.subject2EventName(subject);
		let subscribers:SubscriberItem[]|undefined = this.subscribers.get(eventName);
		if(!subscribers)
			return
		if(!uid){
			this.subscribers.delete(eventName);
		}else{
			subscribers = subscribers.filter(sub=>sub.uid!=uid)
			this.subscribers.set(eventName, subscribers);
		}
	}

}
