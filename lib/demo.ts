import {Client} from './client';

const client = new Client({
	host:"127.0.0.1:42210"
});
client.connect();


const testNotification = async(name="BlockAdded", data={})=>{
    let callback = (res:any)=>{
        console.log(`${name}Notification`, res)
    }

    let response = await client.subscribe(`notify${name}Request`, data, callback)
    .catch(e=>{
        console.log(`notify${name}Request:error`, e)
    })

    console.log(`notify${name}Response`, response);
}


testNotification("UtxosChanged", {addresses:["pugdagtest:qpuyhaxz2chn3lsvf8g7q5uvaezpp5m7pyny4k8tyq"]});
