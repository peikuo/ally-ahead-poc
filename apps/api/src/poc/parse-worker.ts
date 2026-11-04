import {parentPort,workerData} from 'node:worker_threads';
import {parseReceptionDocument} from '../modules/files/reception-document-parser.js';
try{parentPort!.postMessage({ok:true,result:await parseReceptionDocument(workerData.format,Buffer.from(workerData.bytes))});}catch{parentPort!.postMessage({ok:false});}
