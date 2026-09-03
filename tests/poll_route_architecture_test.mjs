import assert from 'node:assert/strict';
import { pollRouteForCase,pollRouteFromEvidence } from '../src/workflows/pon.js';
const fact=(value,source='billing:olt-selected-option')=>({value,source});
assert.equal(pollRouteForCase({pon:{oltName:fact('Teremky OLT Huawei')}}).action,'313');
assert.equal(pollRouteForCase({pon:{tmcOltName:fact('Some GCOM node','userside:tmc-olt-name')}}).action,'','TMC alone never selects a poll');
assert.equal(pollRouteForCase({pon:{oltName:fact('Some GCOM node')}}).action,'312');
assert.equal(pollRouteFromEvidence({oltName:'Huawei MA5800',interfaceName:'EPON0/1/5',pollAction:'310'}).action,'313');
console.log('poll_route_architecture_test: PASS');
