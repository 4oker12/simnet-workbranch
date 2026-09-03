import assert from 'node:assert/strict';
import { canonicalFactEquivalent, chooseCanonicalFactValue } from '../src/state/facts.js';
const context={target:{accessDeviceId:{value:'57194'}},incoming:{accessDeviceId:{value:'57194'}}};
const short='D-Link DGS-3630-28TC';
const long='D-Link DGS-3630-28TC - Киев, пров. Електриків #564';
assert.equal(canonicalFactEquivalent('network','accessDeviceName',short,long,context),true);
assert.equal(chooseCanonicalFactValue('network','accessDeviceName',long,short,context),long,'short display label must not downgrade richer canonical label');
assert.equal(canonicalFactEquivalent('pon','locatedInterface','GPON0/1/2','gpon0/1/2:14'),true);
console.log('fact_normalization_architecture_test: PASS');
