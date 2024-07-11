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
const client_1 = require("./client");
const client = new client_1.Client({
    host: "127.0.0.1:42210"
});
client.connect();
const testNotification = (name = "BlockAdded", data = {}) => __awaiter(void 0, void 0, void 0, function* () {
    let callback = (res) => {
        console.log(`${name}Notification`, res);
    };
    let response = yield client.subscribe(`notify${name}Request`, data, callback)
        .catch(e => {
        console.log(`notify${name}Request:error`, e);
    });
    console.log(`notify${name}Response`, response);
});
testNotification("UtxosChanged", { addresses: ["pugdagtest:qpuyhaxz2chn3lsvf8g7q5uvaezpp5m7pyny4k8tyq"] });
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoiZGVtby5qcyIsInNvdXJjZVJvb3QiOiIiLCJzb3VyY2VzIjpbIi4uLy4uL2xpYi9kZW1vLnRzIl0sIm5hbWVzIjpbXSwibWFwcGluZ3MiOiI7Ozs7Ozs7Ozs7O0FBQUEscUNBQWdDO0FBRWhDLE1BQU0sTUFBTSxHQUFHLElBQUksZUFBTSxDQUFDO0lBQ3pCLElBQUksRUFBQyxpQkFBaUI7Q0FDdEIsQ0FBQyxDQUFDO0FBQ0gsTUFBTSxDQUFDLE9BQU8sRUFBRSxDQUFDO0FBR2pCLE1BQU0sZ0JBQWdCLEdBQUcsQ0FBTSxJQUFJLEdBQUMsWUFBWSxFQUFFLElBQUksR0FBQyxFQUFFLEVBQUMsRUFBRTtJQUN4RCxJQUFJLFFBQVEsR0FBRyxDQUFDLEdBQU8sRUFBQyxFQUFFO1FBQ3RCLE9BQU8sQ0FBQyxHQUFHLENBQUMsR0FBRyxJQUFJLGNBQWMsRUFBRSxHQUFHLENBQUMsQ0FBQTtJQUMzQyxDQUFDLENBQUE7SUFFRCxJQUFJLFFBQVEsR0FBRyxNQUFNLE1BQU0sQ0FBQyxTQUFTLENBQUMsU0FBUyxJQUFJLFNBQVMsRUFBRSxJQUFJLEVBQUUsUUFBUSxDQUFDO1NBQzVFLEtBQUssQ0FBQyxDQUFDLENBQUEsRUFBRTtRQUNOLE9BQU8sQ0FBQyxHQUFHLENBQUMsU0FBUyxJQUFJLGVBQWUsRUFBRSxDQUFDLENBQUMsQ0FBQTtJQUNoRCxDQUFDLENBQUMsQ0FBQTtJQUVGLE9BQU8sQ0FBQyxHQUFHLENBQUMsU0FBUyxJQUFJLFVBQVUsRUFBRSxRQUFRLENBQUMsQ0FBQztBQUNuRCxDQUFDLENBQUEsQ0FBQTtBQUdELGdCQUFnQixDQUFDLGNBQWMsRUFBRSxFQUFDLFNBQVMsRUFBQyxDQUFDLHdEQUF3RCxDQUFDLEVBQUMsQ0FBQyxDQUFDIiwic291cmNlc0NvbnRlbnQiOlsiaW1wb3J0IHtDbGllbnR9IGZyb20gJy4vY2xpZW50JztcblxuY29uc3QgY2xpZW50ID0gbmV3IENsaWVudCh7XG5cdGhvc3Q6XCIxMjcuMC4wLjE6NDIyMTBcIlxufSk7XG5jbGllbnQuY29ubmVjdCgpO1xuXG5cbmNvbnN0IHRlc3ROb3RpZmljYXRpb24gPSBhc3luYyhuYW1lPVwiQmxvY2tBZGRlZFwiLCBkYXRhPXt9KT0+e1xuICAgIGxldCBjYWxsYmFjayA9IChyZXM6YW55KT0+e1xuICAgICAgICBjb25zb2xlLmxvZyhgJHtuYW1lfU5vdGlmaWNhdGlvbmAsIHJlcylcbiAgICB9XG5cbiAgICBsZXQgcmVzcG9uc2UgPSBhd2FpdCBjbGllbnQuc3Vic2NyaWJlKGBub3RpZnkke25hbWV9UmVxdWVzdGAsIGRhdGEsIGNhbGxiYWNrKVxuICAgIC5jYXRjaChlPT57XG4gICAgICAgIGNvbnNvbGUubG9nKGBub3RpZnkke25hbWV9UmVxdWVzdDplcnJvcmAsIGUpXG4gICAgfSlcblxuICAgIGNvbnNvbGUubG9nKGBub3RpZnkke25hbWV9UmVzcG9uc2VgLCByZXNwb25zZSk7XG59XG5cblxudGVzdE5vdGlmaWNhdGlvbihcIlV0eG9zQ2hhbmdlZFwiLCB7YWRkcmVzc2VzOltcImthcmxzZW50ZXN0OnFwdXloYXh6MmNobjNsc3ZmOGc3cTV1dmFlenBwNW03cHlueTRrOHR5cVwiXX0pO1xuIl19