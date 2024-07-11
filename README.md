# Pugdag gRPC interface

Pugdag gRPC module is a basic request/response wrapper for interfacing with [Pugdag](https://github.com/Pugdag/node-pugdag)

## Installing pugdag-grpc

```
npm install -g @pugdag/grpc
```

## Cloning pugdag-grpc

```
git clone https://github.com/Pugdag/node-pugdag-grpc
cd node-pugdag-grpc
npm install
```

## Example

```js
const { Client } = require('@pugdag/grpc');

const client = new Client({
    host:"127.0.0.1:26589"
});
client.connect();
client.verbose = true;

try {
    let response = await client.call('getMempoolEntriesRequest', { });
    console.log(response);
} catch(ex) {
    ...
}

client.call('getVirtualSelectedParentBlueScoreRequest', { }).then((response)=>{
    console.log(response);
}).catch((err)=>{
    console.log('error:',err);
})
```
