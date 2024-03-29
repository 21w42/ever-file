import {
  Address,
  ProviderRpcClient,
  ReadonlyAbiParam
} from 'everscale-inpage-provider';

import { firstTransactionBody, fileBody } from '@/graphQl';

import { ConnectionProperties, EverscaleStandaloneClient } from 'everscale-standalone-client';

import { FileContract } from '@/contracts/FileContract';

import { FileDeployerContract } from '@/contracts/FileDeployerContract';

import { UtilsContract } from '@/contracts/UtilsContract';

import { config } from '@/config';

let _ever: ProviderRpcClient;
let _accountInteraction: everWallet | undefined;

let newHash: string;
let oldSecret = '';

const _everStandalone = new ProviderRpcClient({
  fallback: () =>
    EverscaleStandaloneClient.create({
      connection: config.network.broxus as ConnectionProperties,
    }),
  forceUseFallback: true,
});

async function ever(): Promise<ProviderRpcClient> | never {
  if (typeof _ever === 'undefined') {
    _ever = new ProviderRpcClient();
    if (!(await _ever.hasProvider())) {
      alert('Please install the EverWallet extension');
      throw new Error('Extension is not installed');
    }
  }

  return _ever
}

async function everWallet(): Promise<everWallet | never> {
  const _ever = await ever();
  if (typeof _accountInteraction === 'undefined') {
    const { accountInteraction } = await _ever.requestPermissions({
      permissions: ['basic', 'accountInteraction'],
    });
    if (accountInteraction == null) {
      alert('Issue with permissions');
      throw new Error('Insufficient permissions');
    }
    _accountInteraction = accountInteraction
  }

  return _accountInteraction;
}

export async function deployFileContract(file_size: number): Promise<string | undefined> {
  const everProvider = await ever();
  const accountInteraction = await everWallet();

  //change will be returned later
  const amount = Math.ceil((file_size / 1024 * 0.02 * 1e9 + 5e8) / 1e9) * 1e9;

  const fileDeployerContractObject = new everProvider.Contract(
    FileDeployerContract.abi,
    new Address(config.fileDeployer)
  );
  try {
    const salt = Math.floor(Math.random() * 1e12);
    //deploy file contract
    await fileDeployerContractObject.methods.fileDeploy(
      {
        salt: salt,
        sender: accountInteraction.address,
      }).send({
        from: accountInteraction.address,
        amount: String(amount),
        bounce: true
      })
    //calculate address
    const fileAddress = await fileDeployerContractObject.methods.fileDeploy(
      {
        salt: salt,
        sender: accountInteraction.address,
      }).call()

    return fileAddress.value0.toString();
  } catch (e: unknown) {
    console.error(e);
  }
}


export async function uploadFile(fileInfo: File): Promise<string | undefined> {
  const everProvider = await ever();
  const fileAddress = await deployFileContract(fileInfo.size);

  if (typeof fileAddress === 'undefined') return

  const fileContractObject = new everProvider.Contract(
    FileContract.abi,
    new Address(fileAddress)
  );
  try {
    const newSecret = String(Math.floor(Math.random() * 1e12));
    newHash = await createHash(newSecret);  
    await fileContractObject.methods.upload(
      {
        file_name: fileInfo.name,
        file_size: String(fileInfo.size),
        file_type: fileInfo.type == '' ? 'Unknown' : fileInfo.type,
        newHash: newHash,
        oldSecret: oldSecret
      }).sendExternal({
        publicKey: '0x0',
        withoutSignature: true,
      })
    oldSecret = newSecret;
    return fileAddress;
  } catch (e: unknown) {
    console.error(e);
  }
}

export async function getFileInfo(fileId: string): Promise<FileInfo | undefined> {
  try {
    const body = await firstTransactionBody(fileId);
    if (typeof body === 'undefined') return
    const data = await decodeBody(
      body,
      [
        { "name": "file_name", "type": "string" },
        { "name": "file_size", "type": "string" },
        { "name": "file_type", "type": "string" },
      ]);

    if (typeof data == 'undefined') return;
    return data

  } catch (e: unknown) {
    console.error(e);
    // alert('Wrong message ID')
  }
}

//todo add correct
async function decodeBody(body: string, structure: readonly ReadonlyAbiParam[]) {
  const everProvider = _everStandalone;
  try {
    const message = await everProvider.unpackFromCell({
      structure: structure,
      boc: body,
      allowPartial: true
    });

    return message.data;
  } catch (e) {
    console.error(e);
  }
}
export const createChunks = (base64: string, cSize: number) => {
  let startPointer = 0;
  const endPointer = base64.length;
  const chunks = [];
  while (startPointer < endPointer) {
    const newStartPointer = startPointer + cSize;
    chunks.push(base64.slice(startPointer, newStartPointer));
    startPointer = newStartPointer;
  }
  return chunks;
}

export const uploadChunk = async (fileId: string, chunk: string, chunkNumber: number) => {
  const everProvider = await ever();
  const fileContractObject = new everProvider.Contract(
    FileContract.abi,
    new Address(fileId)
  );
  try {
    const newSecret = String(Math.floor(Math.random() * 1e9));
    newHash = await createHash(newSecret);
    await fileContractObject.methods.uploadChunk(
      {
        chunk: chunk,
        chunkNumber: String(chunkNumber),
        newHash: newHash,
        oldSecret: oldSecret
      }).sendExternal({
        publicKey: '0x0',
        withoutSignature: true,
      })
    oldSecret = newSecret;
  } catch (e: unknown) {
    console.error(e);
  }
}

export const returnChange = async (fileId: string) => {
  const everProvider = await ever();
  const fileContractObject = new everProvider.Contract(
    FileContract.abi,
    new Address(fileId)
  );
  try {
    const newSecret = String(Math.floor(Math.random() * 1e12));
    newHash = await createHash(newSecret); 
    await fileContractObject.methods.returnChange(
      {
        newHash: newHash,
        oldSecret: oldSecret
      }).sendExternal({
        publicKey: '0x0',
        withoutSignature: true,
      })
      oldSecret = ''
  } catch (e: unknown) {
    console.error(e);
  }
}

//todo add base64 type for fun
export const downloadFile = async (fileId: string): Promise<string | undefined> => {
  let created_at = 0
  const messages = []
  for (; ;) {
    const group = await fileBody(fileId, 50, created_at);
    if (typeof group === 'undefined') return
    if (group.length === 0) break
    created_at = group[group.length - 1].created_at
    messages.push(...group)
  }
  //delete first becouse it is not a chunk but a file info
  messages.shift()

  for (let i = 0; i < messages.length; i++) {
    const decoded = (await decodeBody(messages[i].body, [
      { "name": "chunk", "type": "string" },
      { "name": "chunkNumber", "type": "string" }
    ])) as { chunk: string, chunkNumber: string } | undefined

    if (typeof decoded === 'undefined' || decoded.chunk === '') {
      messages.splice(i); //stop '' mesage was found
      break
    }

    messages[i].body = decoded.chunk
  }
  let base64 = ''
  for (let i = 0; i < messages.length; i++) {
    base64 += messages[i].body
  }
  return base64
}

export async function createHash(s: string) {

  const everProvider = await ever();
  const Utils = new everProvider.Contract(
    UtilsContract.abi,
    new Address(config.utils)
  );
  const hash = await Utils.methods.hash(
    {
      s: s,
    }).call()
  return hash.value0
}
