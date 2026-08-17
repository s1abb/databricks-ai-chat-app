import fs from 'node:fs';

const path = 'appkit.plugins.json';
const manifest = JSON.parse(fs.readFileSync(path, 'utf-8'));

manifest.plugins.serving.resources.required = [
  {
    type: 'serving_endpoint',
    alias: 'GPT OSS 120B',
    resourceKey: 'serving-endpoint',
    description: 'Model Serving endpoint for inference',
    permission: 'CAN_QUERY',
    fields: {
      name: {
        env: 'MODEL_GPT_OSS_ENDPOINT_NAME',
        description: 'Serving endpoint name',
        origin: 'user',
      },
    },
  },
  {
    type: 'serving_endpoint',
    alias: 'Llama 3.3 70B',
    resourceKey: 'serving-endpoint-llama',
    description: 'Model Serving endpoint for inference',
    permission: 'CAN_QUERY',
    fields: {
      name: {
        env: 'MODEL_LLAMA_ENDPOINT_NAME',
        description: 'Serving endpoint name',
        origin: 'user',
      },
    },
  },
  {
    type: 'serving_endpoint',
    alias: 'Qwen3.5 122B',
    resourceKey: 'serving-endpoint-qwen',
    description: 'Model Serving endpoint for inference',
    permission: 'CAN_QUERY',
    fields: {
      name: {
        env: 'MODEL_QWEN_ENDPOINT_NAME',
        description: 'Serving endpoint name',
        origin: 'user',
      },
    },
  },
  {
    type: 'serving_endpoint',
    alias: 'Embeddings',
    resourceKey: 'serving-endpoint-embed',
    description: 'Model Serving endpoint for inference',
    permission: 'CAN_QUERY',
    fields: {
      name: {
        env: 'MODEL_EMBED_ENDPOINT_NAME',
        description: 'Serving endpoint name',
        origin: 'user',
      },
    },
  },
];

fs.writeFileSync(path, JSON.stringify(manifest, null, 2) + '\n');
console.log('[fix-serving-manifest] patched serving resources for multi-endpoint config');