"use strict";
var __awaiter = (this && this.__awaiter) || function (thisArg, _arguments, P, generator) {
    function adopt(value) { return value instanceof P ? value : new P(function (resolve) { resolve(value); }); }
    return new (P || (P = Promise))(function (resolve, reject) {
        function fulfilled(value) { try { step(generator.next(value)); } catch (e) { reject(e); } }
        function rejected(value) { try { step(generator["throw"](value)); } catch (e) { reject(e); } }
        function step(result) { result.done ? resolve(result.value) : adopt(result.value).then(fulfilled, rejected); }
        step((generator = generator.apply(thisArg, _arguments || [])).next());
    });
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.Client = void 0;
const flow_async_1 = require("@aspectron/flow-async");
const gRPC = require("@grpc/grpc-js");
const protoLoader = require("@grpc/proto-loader");
const path_1 = require("path");
class Client {
    constructor(options) {
        this.reconnect = true;
        this.verbose = false;
        this.subscribers = new Map();
        this.isConnected = false;
        this.connectCBs = [];
        this.connectFailureCBs = [];
        this.errorCBs = [];
        this.disconnectCBs = [];
        this.options = Object.assign({
            protoPath: __dirname + '/../../proto/messages.proto',
            host: 'localhost:42210',
            reconnect: true,
            verbose: false,
            uid: (Math.random() * 1000).toFixed(0),
        }, options || {});
        this.pending = {};
        this.log = Function.prototype.bind.call(console.log, console, `[Pugdag gRPC ${this.options.uid}]:`);
        this.reconnect = this.options.reconnect;
        this.verbose = this.options.verbose;
        this.connectionPhase = false;
        this.disableConnectionCheck = options.disableConnectionCheck || false;
        // console.log(this);
    }
    getServiceClient() {
        const { protoPath } = this.options;
        const packageDefinition = protoLoader.loadSync(protoPath, {
            keepCase: true,
            longs: String,
            enums: String,
            defaults: true,
            oneofs: true
        });
        const proto = gRPC.loadPackageDefinition(packageDefinition);
        this.proto = proto.protowire;
        const { P2P, RPC } = proto.protowire;
        return RPC;
    }
    connect() {
        this.reconnect = true;
        return this._connect();
    }
    _connect() {
        return __awaiter(this, void 0, void 0, function* () {
            // console.trace("gRPC connection phase...");
            this.verbose && this.log('gRPC Client connecting to', this.options.host);
            if (!this.client) {
                const RPC = this.getServiceClient();
                this.client = new RPC(this.options.host, gRPC.credentials.createInsecure(), {
                    // "grpc.keepalive_timeout_ms": 25000 
                    "grpc.max_receive_message_length": -1
                });
            }
            else {
                // console.log("WARNING: multiple gRPC connection phases!");
                return new Promise((resolve) => {
                    this.onConnect(resolve);
                });
            }
            yield this._connectClient();
        });
    }
    _reconnect(reason) {
        this._setConnected(false);
        if (this.reconnect_dpc) {
            (0, flow_async_1.clearDPC)(this.reconnect_dpc);
            delete this.reconnect_dpc;
        }
        this.clearPending(reason);
        delete this.stream;
        //delete this.client;
        if (this.reconnect) {
            this.reconnect_dpc = (0, flow_async_1.dpc)(1000, () => {
                this._connectClient();
            });
        }
    }
    _connectClient() {
        return __awaiter(this, void 0, void 0, function* () {
            this.client.waitForReady(2500, (connect_error) => {
                if (connect_error) {
                    //console.log("connect_error")
                    //this.connectionPhase = false;
                    this._reconnect('client connect deadline reached');
                    return (0, path_1.resolve)();
                }
                console.log("client connected");
                this.stream = this.createStream();
                this.initIntake(this.stream);
                this.stream.on('error', (error) => {
                    // console.log("client:",error);
                    this.errorCBs.forEach(fn => fn(error.toString(), error));
                    this.verbose && this.log('stream:error', error);
                    this._reconnect(error);
                });
                this.stream.on('end', (...args) => {
                    this.verbose && this.log('stream:end', ...args);
                    this._reconnect('stream end');
                });
                if (this.disableConnectionCheck)
                    return (0, path_1.resolve)();
                (0, flow_async_1.dpc)(100, () => __awaiter(this, void 0, void 0, function* () {
                    let response = yield this.call('getVirtualSelectedParentBlueScoreRequest', {})
                        .catch(e => {
                        this.connectFailureCBs.forEach(fn => fn(e));
                    });
                    this.verbose && this.log("getVirtualSelectedParentBlueScoreRequest:response", response);
                    if (response && response.blueScore) {
                        this._setConnected(true);
                    }
                    (0, path_1.resolve)();
                }));
            });
        });
    }
    _setConnected(isConnected) {
        if (this.isConnected == isConnected)
            return;
        this.isConnected = isConnected;
        let cbs = isConnected ? this.connectCBs : this.disconnectCBs;
        //console.log("this.isConnected", this.isConnected, cbs)
        cbs.forEach(fn => {
            fn();
        });
    }
    onConnect(callback) {
        this.connectCBs.push(callback);
        if (this.isConnected)
            callback();
    }
    onConnectFailure(callback) {
        this.connectFailureCBs.push(callback);
    }
    onError(callback) {
        this.errorCBs.push(callback);
    }
    onDisconnect(callback) {
        this.disconnectCBs.push(callback);
    }
    disconnect() {
        if (this.reconnect_dpc) {
            (0, flow_async_1.clearDPC)(this.reconnect_dpc);
            delete this.reconnect_dpc;
        }
        this.reconnect = false;
        this.stream && this.stream.end();
        this.clearPending();
    }
    clearPending(reason) {
        Object.keys(this.pending).forEach(key => {
            let list = this.pending[key];
            list.forEach(o => o.reject(reason || 'closing by force'));
            this.pending[key] = [];
        });
    }
    close() {
        this.disconnect();
    }
    createStream() {
        if (!this.client)
            return null;
        const stream = this.client.MessageStream(() => {
        });
        //console.log("stream", stream)
        return stream;
    }
    initIntake(stream) {
        stream.on('data', (data) => {
            //this.log("stream:data", data)
            if (data.payload) {
                let name = data.payload;
                let payload = data[name];
                let ident = name.replace(/^get|Response$/ig, '').toLowerCase();
                this.handleIntake({ name, payload, ident });
            }
        });
    }
    handleIntake(o) {
        if (this.intakeHandler) {
            this.intakeHandler(o);
        }
        else {
            let handlers = this.pending[o.name];
            this.verbose && console.log('intake:', o, 'handlers:', handlers);
            //if(o.name == 'getUtxosByAddressesResponse'){
            //	console.log(JSON.stringify(o, null, "  "));
            //}
            if (handlers && handlers.length) {
                let pending = handlers.shift();
                if (pending)
                    pending.resolve(o.payload);
            }
            let subscribers = this.subscribers.get(o.name);
            //this.log("handleIntake:o.name:", o.name, subscribers)
            if (subscribers) {
                subscribers.map(subscriber => {
                    subscriber.callback(o.payload);
                });
            }
        }
    }
    setIntakeHandler(fn) {
        this.intakeHandler = fn;
    }
    post(name, args = {}) {
        if (!this.stream)
            return false;
        let req = {
            [name]: args
        };
        this.verbose && this.log('post:', req);
        this.stream.write(req);
        return true;
    }
    call(method, data) {
        this.verbose && this.log('call to', method);
        if (!this.client)
            return Promise.reject('not connected');
        return new Promise((resolve, reject) => {
            let stream = this.stream;
            if (!stream) {
                this.verbose && this.log('could not create stream');
                return reject('not connected');
            }
            const resp = method.replace(/Request$/, 'Response');
            if (!this.pending[resp])
                this.pending[resp] = [];
            let handlers = this.pending[resp];
            handlers.push({ method, data, resolve, reject });
            this.post(method, data);
        });
    }
    subscribe(subject, data = {}, callback) {
        if (typeof data == 'function') {
            callback = data;
            data = {};
        }
        this.verbose && this.log('subscribe to', subject);
        if (!this.client)
            return Promise.reject('not connected');
        let eventName = this.subject2EventName(subject);
        this.verbose && this.log("subscribe:eventName", eventName);
        let subscribers = this.subscribers.get(eventName);
        if (!subscribers) {
            subscribers = [];
            this.subscribers.set(eventName, subscribers);
        }
        let uid = (Math.random() * 100000 + Date.now()).toFixed(0);
        subscribers.push({ uid, callback });
        let p = this.call(subject, data);
        p.uid = uid;
        return p;
    }
    subject2EventName(subject) {
        let eventName = subject.replace("notify", "").replace("Request", "Notification");
        return eventName[0].toLowerCase() + eventName.substr(1);
    }
    unSubscribe(subject, uid = '') {
        let eventName = this.subject2EventName(subject);
        let subscribers = this.subscribers.get(eventName);
        if (!subscribers)
            return;
        if (!uid) {
            this.subscribers.delete(eventName);
        }
        else {
            subscribers = subscribers.filter(sub => sub.uid != uid);
            this.subscribers.set(eventName, subscribers);
        }
    }
}
exports.Client = Client;
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoiY2xpZW50LmpzIiwic291cmNlUm9vdCI6IiIsInNvdXJjZXMiOlsiLi4vLi4vbGliL2NsaWVudC50cyJdLCJuYW1lcyI6W10sIm1hcHBpbmdzIjoiOzs7Ozs7Ozs7Ozs7QUFHQSxzREFBc0Q7QUFDdEQsc0NBQXNDO0FBQ3RDLGtEQUFrRDtBQU1sRCwrQkFBK0I7QUFHL0IsTUFBYSxNQUFNO0lBb0JsQixZQUFZLE9BQVc7UUFmdkIsY0FBUyxHQUFXLElBQUksQ0FBQztRQUd6QixZQUFPLEdBQVcsS0FBSyxDQUFDO1FBR3hCLGdCQUFXLEdBQXNCLElBQUksR0FBRyxFQUFFLENBQUM7UUFDM0MsZ0JBQVcsR0FBUyxLQUFLLENBQUM7UUFDMUIsZUFBVSxHQUFjLEVBQUUsQ0FBQztRQUMzQixzQkFBaUIsR0FBYyxFQUFFLENBQUM7UUFDbEMsYUFBUSxHQUFjLEVBQUUsQ0FBQztRQUN6QixrQkFBYSxHQUFjLEVBQUUsQ0FBQztRQUs3QixJQUFJLENBQUMsT0FBTyxHQUFHLE1BQU0sQ0FBQyxNQUFNLENBQUM7WUFDNUIsU0FBUyxFQUFFLFNBQVMsR0FBRyw2QkFBNkI7WUFDcEQsSUFBSSxFQUFFLGlCQUFpQjtZQUN2QixTQUFTLEVBQUUsSUFBSTtZQUNmLE9BQU8sRUFBRyxLQUFLO1lBQ2YsR0FBRyxFQUFDLENBQUMsSUFBSSxDQUFDLE1BQU0sRUFBRSxHQUFDLElBQUksQ0FBQyxDQUFDLE9BQU8sQ0FBQyxDQUFDLENBQUM7U0FDbkMsRUFBRSxPQUFPLElBQUUsRUFBRSxDQUFDLENBQUM7UUFDaEIsSUFBSSxDQUFDLE9BQU8sR0FBRyxFQUFHLENBQUM7UUFDbkIsSUFBSSxDQUFDLEdBQUcsR0FBRyxRQUFRLENBQUMsU0FBUyxDQUFDLElBQUksQ0FBQyxJQUFJLENBQ3RDLE9BQU8sQ0FBQyxHQUFHLEVBQ1gsT0FBTyxFQUNQLGlCQUFpQixJQUFJLENBQUMsT0FBTyxDQUFDLEdBQUcsSUFBSSxDQUNyQyxDQUFDO1FBQ0YsSUFBSSxDQUFDLFNBQVMsR0FBRyxJQUFJLENBQUMs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QUFjLENBQUMsQ0FBQTtRQUNoRixPQUFPLFNBQVMsQ0FBQyxDQUFDLENBQUMsQ0FBQyxXQUFXLEVBQUUsR0FBQyxTQUFTLENBQUMsTUFBTSxDQUFDLENBQUMsQ0FBQyxDQUFDO0lBQ3ZELENBQUM7SUFFRCxXQUFXLENBQUMsT0FBYyxFQUFFLE1BQVcsRUFBRTtRQUN4QyxJQUFJLFNBQVMsR0FBRyxJQUFJLENBQUMsaUJBQWlCLENBQUMsT0FBTyxDQUFDLENBQUM7UUFDaEQsSUFBSSxXQUFXLEdBQThCLElBQUksQ0FBQyxXQUFXLENBQUMsR0FBRyxDQUFDLFNBQVMsQ0FBQyxDQUFDO1FBQzdFLElBQUcsQ0FBQyxXQUFXO1lBQ2QsT0FBTTtRQUNQLElBQUcsQ0FBQyxHQUFHLEVBQUMsQ0FBQztZQUNSLElBQUksQ0FBQyxXQUFXLENBQUMsTUFBTSxDQUFDLFNBQVMsQ0FBQyxDQUFDO1FBQ3BDLENBQUM7YUFBSSxDQUFDO1lBQ0wsV0FBVyxHQUFHLFdBQVcsQ0FBQyxNQUFNLENBQUMsR0FBRyxDQUFBLEVBQUUsQ0FBQSxHQUFHLENBQUMsR0FBRyxJQUFFLEdBQUcsQ0FBQyxDQUFBO1lBQ25ELElBQUksQ0FBQyxXQUFXLENBQUMsR0FBRyxDQUFDLFNBQVMsRUFBRSxXQUFXLENBQUMsQ0FBQztRQUM5QyxDQUFDO0lBQ0YsQ0FBQztDQUVEO0FBL1RELHdCQStUQyIsInNvdXJjZXNDb250ZW50IjpbImltcG9ydCAqIGFzIGZzIGZyb20gJ2ZzJztcbmltcG9ydCAqIGFzIHBhdGggZnJvbSAncGF0aCc7XG5pbXBvcnQgeyBFdmVudEVtaXR0ZXIgfSBmcm9tICdldmVudHMnO1xuaW1wb3J0IHsgZHBjLCBjbGVhckRQQyB9IGZyb20gJ0Bhc3BlY3Ryb24vZmxvdy1hc3luYyc7XG5pbXBvcnQgKiBhcyBnUlBDIGZyb20gJ0BncnBjL2dycGMtanMnO1xuaW1wb3J0ICogYXMgcHJvdG9Mb2FkZXIgZnJvbSAnQGdycGMvcHJvdG8tbG9hZGVyJztcbmltcG9ydCB7XG5cdFBlbmRpbmdSZXFzLCBJRGF0YSwgSVN0cmVhbSwgUXVldWVJdGVtLCBNZXNzYWdlc1Byb3RvLFxuXHRTZXJ2aWNlQ2xpZW50Q29uc3RydWN0b3IsIEthcmxzZW5kUGFja2FnZSwgU3Vic2NyaWJlckl0ZW0sIFN1YnNjcmliZXJJdGVtTWFwLFxuXHRSUEMgYXMgUnBjXG59IGZyb20gJy4uL3R5cGVzL2N1c3RvbS10eXBlcyc7XG5pbXBvcnQgeyByZXNvbHZlIH0gZnJvbSAncGF0aCc7XG5cbiBcbmV4cG9ydCBjbGFzcyBDbGllbnQge1xuXHRzdHJlYW06SVN0cmVhbTtcblx0b3B0aW9uczphbnk7XG5cdHBlbmRpbmc6UGVuZGluZ1JlcXM7XG5cdGludGFrZUhhbmRsZXI6RnVuY3Rpb258dW5kZWZpbmVkO1xuXHRyZWNvbm5lY3Q6Ym9vbGVhbiA9IHRydWU7XG5cdGNsaWVudDphbnl8dW5kZWZpbmVkO1xuXHRyZWNvbm5lY3RfZHBjOm51bWJlcnx1bmRlZmluZWQ7XG5cdHZlcmJvc2U6Ym9vbGVhbiA9IGZhbHNlO1xuXHRsb2c6RnVuY3Rpb247XG5cdHByb3RvOkthcmxzZW5kUGFja2FnZXx1bmRlZmluZWQ7XG5cdHN1YnNjcmliZXJzOiBTdWJzY3JpYmVySXRlbU1hcCA9IG5ldyBNYXAoKTtcblx0aXNDb25uZWN0ZWQ6Ym9vbGVhbj1mYWxzZTtcblx0Y29ubmVjdENCczpGdW5jdGlvbltdID0gW107XG5cdGNvbm5lY3RGYWlsdXJlQ0JzOkZ1bmN0aW9uW10gPSBbXTtcblx0ZXJyb3JDQnM6RnVuY3Rpb25bXSA9IFtdO1xuXHRkaXNjb25uZWN0Q0JzOkZ1bmN0aW9uW10gPSBbXTtcblx0Y29ubmVjdGlvblBoYXNlOmJvb2xlYW47XG5cdGRpc2FibGVDb25uZWN0aW9uQ2hlY2s6Ym9vbGVhbjtcblxuXHRjb25zdHJ1Y3RvcihvcHRpb25zOmFueSkge1xuXHRcdHRoaXMub3B0aW9ucyA9IE9iamVjdC5hc3NpZ24oe1xuXHRcdFx0cHJvdG9QYXRoOiBfX2Rpcm5hbWUgKyAnLy4uLy4uL3Byb3RvL21lc3NhZ2VzLnByb3RvJyxcblx0XHRcdGhvc3Q6ICdsb2NhbGhvc3Q6NDIyMTAnLFxuXHRcdFx0cmVjb25uZWN0OiB0cnVlLFxuXHRcdFx0dmVyYm9zZSA6IGZhbHNlLFxuXHRcdFx0dWlkOihNYXRoLnJhbmRvbSgpKjEwMDApLnRvRml4ZWQoMCksXG5cdFx0fSwgb3B0aW9uc3x8e30pO1xuXHRcdHRoaXMucGVuZGluZyA9IHsgfTtcblx0XHR0aGlzLmxvZyA9IEZ1bmN0aW9uLnByb3RvdHlwZS5iaW5kLmNhbGwoXG5cdFx0XHRjb25zb2xlLmxvZyxcblx0XHRcdGNvbnNvbGUsXG5cdFx0XHRgW0thcmxzZW4gZ1JQQyAke3RoaXMub3B0aW9ucy51aWR9XTpgXG5cdFx0KTtcblx0XHR0aGlzLnJlY29ubmVjdCA9IHRoaXMub3B0aW9ucy5yZWNvbm5lY3Q7XG5cdFx0dGhpcy52ZXJib3NlID0gdGhpcy5vcHRpb25zLnZlcmJvc2U7XG5cdFx0dGhpcy5jb25uZWN0aW9uUGhhc2UgPSBmYWxzZTtcblx0XHR0aGlzLmRpc2FibGVDb25uZWN0aW9uQ2hlY2sgPSBvcHRpb25zLmRpc2FibGVDb25uZWN0aW9uQ2hlY2sgfHwgZmFsc2U7XG5cdFx0Ly8gY29uc29sZS5sb2codGhpcyk7XG5cdH1cblxuXHRnZXRTZXJ2aWNlQ2xpZW50KCk6U2VydmljZUNsaWVudENvbnN0cnVjdG9yIHtcblx0XHRjb25zdCB7cHJvdG9QYXRofSA9IHRoaXMub3B0aW9ucztcblx0XHRjb25zdCBwYWNrYWdlRGVmaW5pdGlvbiA9IHByb3RvTG9hZGVyLmxvYWRTeW5jKHByb3RvUGF0aCwge1xuXHRcdFx0a2VlcENhc2U6IHRydWUsXG5cdFx0XHRsb25nczogU3RyaW5nLFxuXHRcdFx0ZW51bXM6IFN0cmluZyxcblx0XHRcdGRlZmF1bHRzOiB0cnVlLFxuXHRcdFx0b25lb2ZzOiB0cnVlXG5cdFx0fSk7XG5cblx0XHRjb25zdCBwcm90bzpNZXNzYWdlc1Byb3RvID0gPE1lc3NhZ2VzUHJvdG8+Z1JQQy5sb2FkUGFja2FnZURlZmluaXRpb24ocGFja2FnZURlZmluaXRpb24pO1xuXHRcdHRoaXMucHJvdG8gPSBwcm90by5wcm90b3dpcmU7XG5cdFx0Y29uc3Qge1AyUCwgUlBDfSA9IHByb3RvLnByb3Rvd2lyZTtcblx0XHRyZXR1cm4gUlBDO1xuXHR9XG5cdGNvbm5lY3QoKXtcblx0XHR0aGlzLnJlY29ubmVjdCA9IHRydWU7XG5cdFx0cmV0dXJuIHRoaXMuX2Nvbm5lY3QoKTtcblx0fVxuXG5cdGFzeW5jIF9jb25uZWN0KCkge1xuXHRcdC8vIGNvbnNvbGUudHJhY2UoXCJnUlBDIGNvbm5lY3Rpb24gcGhhc2UuLi5cIik7XG5cdFx0dGhpcy52ZXJib3NlICYmIHRoaXMubG9nKCdnUlBDIENsaWVudCBjb25uZWN0aW5nIHRvJywgdGhpcy5vcHRpb25zLmhvc3QpO1xuXHRcdGlmKCF0aGlzLmNsaWVudCl7XG5cdFx0XHRjb25zdCBSUEMgPSB0aGlzLmdldFNlcnZpY2VDbGllbnQoKTtcblx0XHRcdHRoaXMuY2xpZW50ID0gbmV3IFJQQyh0aGlzLm9wdGlvbnMuaG9zdCwgZ1JQQy5jcmVkZW50aWFscy5jcmVhdGVJbnNlY3VyZSgpLFxuXHRcdFx0XHR7IFxuXHRcdFx0XHRcdC8vIFwiZ3JwYy5rZWVwYWxpdmVfdGltZW91dF9tc1wiOiAyNTAwMCBcblx0XHRcdFx0XHRcImdycGMubWF4X3JlY2VpdmVfbWVzc2FnZV9sZW5ndGhcIjogLTFcblx0XHRcdFx0fVxuXHRcdFx0KTtcblx0XHR9ZWxzZXtcblx0XHRcdC8vIGNvbnNvbGUubG9nKFwiV0FSTklORzogbXVsdGlwbGUgZ1JQQyBjb25uZWN0aW9uIHBoYXNlcyFcIik7XG5cdFx0XHRyZXR1cm4gbmV3IFByb21pc2UoKHJlc29sdmUpID0+IHtcblx0XHRcdFx0dGhpcy5vbkNvbm5lY3QocmVzb2x2ZSk7XG5cdFx0XHR9KVxuXHRcdH1cblxuXHRcdGF3YWl0IHRoaXMuX2Nvbm5lY3RDbGllbnQoKTtcblx0fVxuXHRfcmVjb25uZWN0KHJlYXNvbjpzdHJpbmcpe1xuXHRcdHRoaXMuX3NldENvbm5lY3RlZChmYWxzZSk7XG5cdFx0aWYodGhpcy5yZWNvbm5lY3RfZHBjKSB7XG5cdFx0XHRjbGVhckRQQyh0aGlzLnJlY29ubmVjdF9kcGMpO1xuXHRcdFx0ZGVsZXRlIHRoaXMucmVjb25uZWN0X2RwYztcblx0XHR9XG5cblx0XHR0aGlzLmNsZWFyUGVuZGluZyhyZWFzb24pO1xuXHRcdGRlbGV0ZSB0aGlzLnN0cmVhbTtcblx0XHQvL2RlbGV0ZSB0aGlzLmNsaWVudDtcblx0XHRpZih0aGlzLnJlY29ubmVjdCkge1xuXHRcdFx0dGhpcy5yZWNvbm5lY3RfZHBjID0gZHBjKDEwMDAsICgpID0+IHtcblx0XHRcdFx0dGhpcy5fY29ubmVjdENsaWVudCgpO1xuXHRcdFx0fSlcblx0XHR9XG5cdH1cblx0YXN5bmMgX2Nvbm5lY3RDbGllbnQoKXtcblx0XHR0aGlzLmNsaWVudC53YWl0Rm9yUmVhZHkoMjUwMCwgKGNvbm5lY3RfZXJyb3I6YW55KT0+e1xuXHRcdFx0XG5cdFx0XHRpZihjb25uZWN0X2Vycm9yKXtcblx0XHRcdFx0Ly9jb25zb2xlLmxvZyhcImNvbm5lY3RfZXJyb3JcIilcblx0XHRcdFx0Ly90aGlzLmNvbm5lY3Rpb25QaGFzZSA9IGZhbHNlO1xuXHRcdFx0XHR0aGlzLl9yZWNvbm5lY3QoJ2NsaWVudCBjb25uZWN0IGRlYWRsaW5lIHJlYWNoZWQnKTtcblx0XHRcdFx0cmV0dXJuIHJlc29sdmUoKTtcblx0XHRcdH1cblxuXHRcdFx0Y29uc29sZS5sb2coXCJjbGllbnQgY29ubmVjdGVkXCIpXG5cblx0XHRcdHRoaXMuc3RyZWFtID0gdGhpcy5jcmVhdGVTdHJlYW0oKTtcblx0XHRcdHRoaXMuaW5pdEludGFrZSh0aGlzLnN0cmVhbSk7XG5cdFx0XHRcblx0XHRcdHRoaXMuc3RyZWFtLm9uKCdlcnJvcicsIChlcnJvcjphbnkpID0+IHtcblx0XHRcdFx0Ly8gY29uc29sZS5sb2coXCJjbGllbnQ6XCIsZXJyb3IpO1xuXHRcdFx0XHR0aGlzLmVycm9yQ0JzLmZvckVhY2goZm49PmZuKGVycm9yLnRvU3RyaW5nKCksIGVycm9yKSk7XG5cdFx0XHRcdHRoaXMudmVyYm9zZSAmJiB0aGlzLmxvZygnc3RyZWFtOmVycm9yJywgZXJyb3IpO1xuXHRcdFx0XHR0aGlzLl9yZWNvbm5lY3QoZXJyb3IpO1xuXHRcdFx0fSlcblx0XHRcdHRoaXMuc3RyZWFtLm9uKCdlbmQnLCAoLi4uYXJnczphbnkpID0+IHtcblx0XHRcdFx0dGhpcy52ZXJib3NlICYmIHRoaXMubG9nKCdzdHJlYW06ZW5kJywgLi4uYXJncyk7XG5cdFx0XHRcdHRoaXMuX3JlY29ubmVjdCgnc3RyZWFtIGVuZCcpO1xuXHRcdFx0fSk7XG5cblx0XHRcdGlmKHRoaXMuZGlzYWJsZUNvbm5lY3Rpb25DaGVjaylcblx0XHRcdFx0cmV0dXJuIHJlc29sdmUoKTtcblx0XHRcdFxuXHRcdFx0ZHBjKDEwMCwgYXN5bmMoKT0+e1xuXHRcdFx0XHRsZXQgcmVzcG9uc2U6YW55ID0gYXdhaXQgdGhpcy5jYWxsKCdnZXRWaXJ0dWFsU2VsZWN0ZWRQYXJlbnRCbHVlU2NvcmVSZXF1ZXN0Jywge30pXG5cdFx0XHRcdC5jYXRjaChlPT57XG5cdFx0XHRcdFx0dGhpcy5jb25uZWN0RmFpbHVyZUNCcy5mb3JFYWNoKGZuPT5mbihlKSk7XG5cdFx0XHRcdH0pXG5cdFx0XHRcdHRoaXMudmVyYm9zZSAmJiB0aGlzLmxvZyhcImdldFZpcnR1YWxTZWxlY3RlZFBhcmVudEJsdWVTY29yZVJlcXVlc3Q6cmVzcG9uc2VcIiwgcmVzcG9uc2UpXG5cdFx0XHRcdGlmKHJlc3BvbnNlICYmIHJlc3BvbnNlLmJsdWVTY29yZSl7XG5cdFx0XHRcdFx0dGhpcy5fc2V0Q29ubmVjdGVkKHRydWUpO1xuXHRcdFx0XHR9XG5cdFx0XHRcdHJlc29sdmUoKTtcblx0XHRcdH0pXG5cdFx0fSlcblx0fVxuXG5cdF9zZXRDb25uZWN0ZWQoaXNDb25uZWN0ZWQ6Ym9vbGVhbil7XG5cdFx0aWYodGhpcy5pc0Nvbm5lY3RlZCA9PSBpc0Nvbm5lY3RlZClcblx0XHRcdHJldHVybjtcblx0XHR0aGlzLmlzQ29ubmVjdGVkID0gaXNDb25uZWN0ZWQ7XG5cblx0XHRsZXQgY2JzID0gaXNDb25uZWN0ZWQ/dGhpcy5jb25uZWN0Q0JzOnRoaXMuZGlzY29ubmVjdENCcztcblx0XHQvL2NvbnNvbGUubG9nKFwidGhpcy5pc0Nvbm5lY3RlZFwiLCB0aGlzLmlzQ29ubmVjdGVkLCBjYnMpXG5cdFx0Y2JzLmZvckVhY2goZm49Pntcblx0XHRcdGZuKCk7XG5cdFx0fSlcblx0fVxuXG5cdG9uQ29ubmVjdChjYWxsYmFjazpGdW5jdGlvbil7XG5cdFx0dGhpcy5jb25uZWN0Q0JzLnB1c2goY2FsbGJhY2spXG5cdFx0aWYodGhpcy5pc0Nvbm5lY3RlZClcblx0XHRcdGNhbGxiYWNrKCk7XG5cdH1cblx0b25Db25uZWN0RmFpbHVyZShjYWxsYmFjazpGdW5jdGlvbil7XG5cdFx0dGhpcy5jb25uZWN0RmFpbHVyZUNCcy5wdXNoKGNhbGxiYWNrKVxuXHR9XG5cdG9uRXJyb3IoY2FsbGJhY2s6RnVuY3Rpb24pe1xuXHRcdHRoaXMuZXJyb3JDQnMucHVzaChjYWxsYmFjaylcblx0fVxuXHRvbkRpc2Nvbm5lY3QoY2FsbGJhY2s6RnVuY3Rpb24pe1xuXHRcdHRoaXMuZGlzY29ubmVjdENCcy5wdXNoKGNhbGxiYWNrKVxuXHR9XG5cblx0ZGlzY29ubmVjdCgpIHtcblx0XHRpZih0aGlzLnJlY29ubmVjdF9kcGMpIHtcblx0XHRcdGNsZWFyRFBDKHRoaXMucmVjb25uZWN0X2RwYyk7XG5cdFx0XHRkZWxldGUgdGhpcy5yZWNvbm5lY3RfZHBjO1xuXHRcdH1cblx0XHR0aGlzLnJlY29ubmVjdCA9IGZhbHNlO1xuXHRcdHRoaXMuc3RyZWFtICYmIHRoaXMuc3RyZWFtLmVuZCgpO1xuXHRcdHRoaXMuY2xlYXJQZW5kaW5nKCk7XG5cdH1cblxuXHRjbGVhclBlbmRpbmcocmVhc29uPzpzdHJpbmcpIHtcblx0XHRPYmplY3Qua2V5cyh0aGlzLnBlbmRpbmcpLmZvckVhY2goa2V5ID0+IHtcblx0XHRcdGxldCBsaXN0ID0gdGhpcy5wZW5kaW5nW2tleV07XG5cdFx0XHRsaXN0LmZvckVhY2gobz0+by5yZWplY3QocmVhc29ufHwnY2xvc2luZyBieSBmb3JjZScpKTtcblx0XHRcdHRoaXMucGVuZGluZ1trZXldID0gW107XG5cdFx0fSk7XG5cdH1cblxuXHRjbG9zZSgpIHtcblx0XHR0aGlzLmRpc2Nvbm5lY3QoKVxuXHR9XG5cblx0Y3JlYXRlU3RyZWFtKCkge1xuXHRcdGlmKCF0aGlzLmNsaWVudClcblx0XHRcdHJldHVybiBudWxsO1xuXHRcdGNvbnN0IHN0cmVhbSA9IHRoaXMuY2xpZW50Lk1lc3NhZ2VTdHJlYW0oKCk9Pntcblx0XHR9KTtcblx0XHQvL2NvbnNvbGUubG9nKFwic3RyZWFtXCIsIHN0cmVhbSlcblx0XHRyZXR1cm4gc3RyZWFtO1xuXHR9XG5cblx0aW5pdEludGFrZShzdHJlYW06SVN0cmVhbSkge1xuXHRcdHN0cmVhbS5vbignZGF0YScsIChkYXRhOmFueSkgPT4ge1xuXHRcdFx0Ly90aGlzLmxvZyhcInN0cmVhbTpkYXRhXCIsIGRhdGEpXG5cdFx0XHRpZihkYXRhLnBheWxvYWQpIHtcblx0XHRcdFx0bGV0IG5hbWUgPSBkYXRhLnBheWxvYWQ7XG5cdFx0XHRcdGxldCBwYXlsb2FkID0gZGF0YVtuYW1lXTtcblx0XHRcdFx0bGV0IGlkZW50ID0gbmFtZS5yZXBsYWNlKC9eZ2V0fFJlc3BvbnNlJC9pZywnJykudG9Mb3dlckNhc2UoKTtcblx0XHRcdFx0dGhpcy5oYW5kbGVJbnRha2Uoe25hbWUsIHBheWxvYWQsIGlkZW50IH0pO1xuXHRcdFx0fVxuXHRcdH0pO1xuXHR9XG5cblx0aGFuZGxlSW50YWtlKG86SURhdGEpIHtcblx0XHRpZih0aGlzLmludGFrZUhhbmRsZXIpIHtcblx0XHRcdHRoaXMuaW50YWtlSGFuZGxlcihvKTtcblx0XHR9IGVsc2Uge1xuXHRcdFx0bGV0IGhhbmRsZXJzID0gdGhpcy5wZW5kaW5nW28ubmFtZV07XG5cdFx0XHR0aGlzLnZlcmJvc2UgJiYgY29uc29sZS5sb2coJ2ludGFrZTonLG8sJ2hhbmRsZXJzOicsaGFuZGxlcnMpO1xuXHRcdFx0Ly9pZihvLm5hbWUgPT0gJ2dldFV0eG9zQnlBZGRyZXNzZXNSZXNwb25zZScpe1xuXHRcdFx0Ly9cdGNvbnNvbGUubG9nKEpTT04uc3RyaW5naWZ5KG8sIG51bGwsIFwiICBcIikpO1xuXHRcdFx0Ly99XG5cdFx0XHRpZihoYW5kbGVycyAmJiBoYW5kbGVycy5sZW5ndGgpe1xuXHRcdFx0XHRsZXQgcGVuZGluZzpRdWV1ZUl0ZW18dW5kZWZpbmVkID0gaGFuZGxlcnMuc2hpZnQoKTtcblx0XHRcdFx0aWYocGVuZGluZylcblx0XHRcdFx0XHRwZW5kaW5nLnJlc29sdmUoby5wYXlsb2FkKTtcblx0XHRcdH1cblxuXHRcdFx0bGV0IHN1YnNjcmliZXJzOlN1YnNjcmliZXJJdGVtW118dW5kZWZpbmVkID0gdGhpcy5zdWJzY3JpYmVycy5nZXQoby5uYW1lKTtcblx0XHRcdC8vdGhpcy5sb2coXCJoYW5kbGVJbnRha2U6by5uYW1lOlwiLCBvLm5hbWUsIHN1YnNjcmliZXJzKVxuXHRcdFx0aWYoc3Vic2NyaWJlcnMpe1xuXHRcdFx0XHRzdWJzY3JpYmVycy5tYXAoc3Vic2NyaWJlcj0+e1xuXHRcdFx0XHRcdHN1YnNjcmliZXIuY2FsbGJhY2soby5wYXlsb2FkKVxuXHRcdFx0XHR9KVxuXHRcdFx0fVxuXHRcdH1cblx0fVxuXG5cdHNldEludGFrZUhhbmRsZXIoZm46RnVuY3Rpb24pIHtcblx0XHR0aGlzLmludGFrZUhhbmRsZXIgPSBmbjtcblx0fVxuXG5cdHBvc3QobmFtZTpzdHJpbmcsIGFyZ3M6YW55PXsgfSkge1xuXHRcdGlmKCF0aGlzLnN0cmVhbSlcblx0XHRcdHJldHVybiBmYWxzZTtcblxuXHRcdGxldCByZXEgPSB7XG5cdFx0XHRbbmFtZV06YXJnc1xuXHRcdH1cblx0XHR0aGlzLnZlcmJvc2UgJiYgdGhpcy5sb2coJ3Bvc3Q6JyxyZXEpO1xuXHRcdHRoaXMuc3RyZWFtLndyaXRlKHJlcSk7XG5cblx0XHRyZXR1cm4gdHJ1ZTtcblx0fVxuXG5cdGNhbGwobWV0aG9kOnN0cmluZywgZGF0YTphbnkpIHtcblx0XHR0aGlzLnZlcmJvc2UgJiYgdGhpcy5sb2coJ2NhbGwgdG8nLCBtZXRob2QpO1xuXHRcdGlmKCF0aGlzLmNsaWVudClcblx0XHRcdHJldHVybiBQcm9taXNlLnJlamVjdCgnbm90IGNvbm5lY3RlZCcpO1xuXG5cdFx0cmV0dXJuIG5ldyBQcm9taXNlKChyZXNvbHZlLCByZWplY3QpID0+IHtcblx0XHRcdGxldCBzdHJlYW0gPSB0aGlzLnN0cmVhbTtcblx0XHRcdGlmKCFzdHJlYW0pIHtcblx0XHRcdFx0dGhpcy52ZXJib3NlICYmICB0aGlzLmxvZygnY291bGQgbm90IGNyZWF0ZSBzdHJlYW0nKTtcblx0XHRcdFx0cmV0dXJuIHJlamVjdCgnbm90IGNvbm5lY3RlZCcpO1xuXHRcdFx0fVxuXG5cdFx0XHRjb25zdCByZXNwID0gbWV0aG9kLnJlcGxhY2UoL1JlcXVlc3QkLywnUmVzcG9uc2UnKTtcblx0XHRcdGlmKCF0aGlzLnBlbmRpbmdbcmVzcF0pXG5cdFx0XHRcdHRoaXMucGVuZGluZ1tyZXNwXSA9IFtdO1xuXHRcdFx0bGV0IGhhbmRsZXJzOlF1ZXVlSXRlbVtdID0gdGhpcy5wZW5kaW5nW3Jlc3BdO1xuXHRcdFx0aGFuZGxlcnMucHVzaCh7bWV0aG9kLCBkYXRhLCByZXNvbHZlLCByZWplY3R9KTtcblxuXHRcdFx0dGhpcy5wb3N0KG1ldGhvZCwgZGF0YSk7XG5cdFx0fSlcblx0fVxuXG5cdHN1YnNjcmliZTxUPihzdWJqZWN0OnN0cmluZywgZGF0YTphbnk9e30sIGNhbGxiYWNrOkZ1bmN0aW9uKTpScGMuU3ViUHJvbWlzZTxUPntcblx0XHRpZih0eXBlb2YgZGF0YSA9PSAnZnVuY3Rpb24nKXtcblx0XHRcdGNhbGxiYWNrID0gZGF0YTtcblx0XHRcdGRhdGEgPSB7fTtcblx0XHR9XG5cblx0XHR0aGlzLnZlcmJvc2UgJiYgdGhpcy5sb2coJ3N1YnNjcmliZSB0bycsIHN1YmplY3QpO1xuXHRcdGlmKCF0aGlzLmNsaWVudClcblx0XHRcdHJldHVybiBQcm9taXNlLnJlamVjdCgnbm90IGNvbm5lY3RlZCcpIGFzIFJwYy5TdWJQcm9taXNlPFQ+O1xuXG5cdFx0bGV0IGV2ZW50TmFtZSA9IHRoaXMuc3ViamVjdDJFdmVudE5hbWUoc3ViamVjdCk7XG5cdFx0dGhpcy52ZXJib3NlICYmIHRoaXMubG9nKFwic3Vic2NyaWJlOmV2ZW50TmFtZVwiLCBldmVudE5hbWUpXG5cblx0XHRsZXQgc3Vic2NyaWJlcnM6U3Vic2NyaWJlckl0ZW1bXXx1bmRlZmluZWQgPSB0aGlzLnN1YnNjcmliZXJzLmdldChldmVudE5hbWUpO1xuXHRcdGlmKCFzdWJzY3JpYmVycyl7XG5cdFx0XHRzdWJzY3JpYmVycyA9IFtdO1xuXHRcdFx0dGhpcy5zdWJzY3JpYmVycy5zZXQoZXZlbnROYW1lLCBzdWJzY3JpYmVycyk7XG5cdFx0fVxuXHRcdGxldCB1aWQgPSAoTWF0aC5yYW5kb20oKSoxMDAwMDAgKyBEYXRlLm5vdygpKS50b0ZpeGVkKDApO1xuXHRcdHN1YnNjcmliZXJzLnB1c2goe3VpZCwgY2FsbGJhY2t9KTtcblxuXHRcdGxldCBwID0gdGhpcy5jYWxsKHN1YmplY3QsIGRhdGEpIGFzIFJwYy5TdWJQcm9taXNlPFQ+O1xuXG5cdFx0cC51aWQgPSB1aWQ7XG5cdFx0cmV0dXJuIHA7XG5cdH1cblxuXHRzdWJqZWN0MkV2ZW50TmFtZShzdWJqZWN0OnN0cmluZyl7XG5cdFx0bGV0IGV2ZW50TmFtZSA9IHN1YmplY3QucmVwbGFjZShcIm5vdGlmeVwiLCBcIlwiKS5yZXBsYWNlKFwiUmVxdWVzdFwiLCBcIk5vdGlmaWNhdGlvblwiKVxuXHRcdHJldHVybiBldmVudE5hbWVbMF0udG9Mb3dlckNhc2UoKStldmVudE5hbWUuc3Vic3RyKDEpO1xuXHR9XG5cblx0dW5TdWJzY3JpYmUoc3ViamVjdDpzdHJpbmcsIHVpZDpzdHJpbmc9Jycpe1xuXHRcdGxldCBldmVudE5hbWUgPSB0aGlzLnN1YmplY3QyRXZlbnROYW1lKHN1YmplY3QpO1xuXHRcdGxldCBzdWJzY3JpYmVyczpTdWJzY3JpYmVySXRlbVtdfHVuZGVmaW5lZCA9IHRoaXMuc3Vic2NyaWJlcnMuZ2V0KGV2ZW50TmFtZSk7XG5cdFx0aWYoIXN1YnNjcmliZXJzKVxuXHRcdFx0cmV0dXJuXG5cdFx0aWYoIXVpZCl7XG5cdFx0XHR0aGlzLnN1YnNjcmliZXJzLmRlbGV0ZShldmVudE5hbWUpO1xuXHRcdH1lbHNle1xuXHRcdFx0c3Vic2NyaWJlcnMgPSBzdWJzY3JpYmVycy5maWx0ZXIoc3ViPT5zdWIudWlkIT11aWQpXG5cdFx0XHR0aGlzLnN1YnNjcmliZXJzLnNldChldmVudE5hbWUsIHN1YnNjcmliZXJzKTtcblx0XHR9XG5cdH1cblxufVxuIl19