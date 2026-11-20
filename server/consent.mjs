import {requireValue} from './policy.mjs';
export const policyVersion='2026-11-20';
export const policies=[
  {id:'terms',name:'Terms and Conditions',page:'terms-of-service'},
  {id:'privacy',name:'Privacy Policy',page:'privacy-policy'},
  {id:'cookies',name:'Cookie Policy',page:'cookie-policy'},
  {id:'refunds',name:'Refund Policy',page:'refund-policy'}
];
export function requireAcceptance(acceptance){
  requireValue(acceptance?.version===policyVersion && policies.every(p=>acceptance?.[p.id]===true),422,'Read and accept all four current policies before continuing.');
}
