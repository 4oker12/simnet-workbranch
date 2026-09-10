import { MessageType } from '../../../shared/messages.js';

const KEYS = [
  'simnet_workbench_transcriber_config_v1',
  'simnet_workbench_transcripts_v1'
];

chrome.runtime.onMessage.addListener(message => {
  if (message?.type !== MessageType.WORKBENCH_DATA_CLEAR) return false;
  void chrome.storage.local.remove(KEYS).catch(error => {
    console.warn('[SIMNET WB][TRANSCRIPTION] cleanup failed', error);
  });
  return false;
});
