import type { InteractionManifest, UiStep } from '../../src/executable-collection/interaction-manifest.js';
export function publicInteractionManifest(kind:'book'|'saas'):InteractionManifest {
  const fields=kind==='book'?['title','author','category','borrower']:['customer','title','category','priority','status'];
  const first=kind==='book'?{title:'The Left Hand',author:'Ursula Le Guin',category:'Novel'}:{customer:'Alex',title:'Export reports',category:'Feature',priority:'high'};
  const second=kind==='book'?{title:'Salt Fat Acid Heat',author:'Samin Nosrat',category:'Cookbook'}:{customer:'Robin',title:'Keyboard shortcuts',category:'Usability',priority:'low'};
  const steps:UiStep[]=[{op:'create',record:'first',values:first},{op:'expect',record:'first',fields},
    {op:'create',record:'second',values:second},{op:'expect',record:'second',fields}];
  if(kind==='book')steps.push(
    {op:'count',counter:'lent'},
    {op:'action',record:'first',action:'lend',input:{borrower:'Alex'}},{op:'expect',record:'first',fields:['borrower']},{op:'count',counter:'lent'},
    {op:'filter',filter:'lent',value:'present'},{op:'visible'},{op:'reload'},{op:'visible'},
    {op:'edit',record:'first',values:{title:'The Left Hand — Revised'}},{op:'expect',record:'first',fields:['title','borrower']},
    {op:'reload'},{op:'expect',record:'first',fields},
    {op:'reject_save',mutation:{op:'edit',record:'first',values:{title:'Rejected edit'}}},
    {op:'action',record:'first',action:'return'},{op:'expect',record:'first',fields:['borrower']},{op:'count',counter:'lent'},
    {op:'remove',record:'second'},{op:'visible'},{op:'reload'},{op:'visible'},
    {op:'invalid_create',values:{title:'',author:'Invalid author',category:'Novel'},field:'title'},
  );
  else steps.push(
    {op:'count',counter:'active'},{op:'count',counter:'shipped'},
    {op:'action',record:'first',action:'plan'},{op:'expect',record:'first',fields:['status']},
    {op:'action',record:'first',action:'start'},{op:'expect',record:'first',fields:['status']},
    {op:'action',record:'first',action:'ship'},{op:'expect',record:'first',fields:['status']},
    {op:'count',counter:'active'},{op:'count',counter:'shipped'},
    {op:'filter',filter:'status',value:'shipped'},{op:'visible'},{op:'filter',filter:'status',value:'*'},
    {op:'filter',filter:'priority',value:'high'},{op:'visible'},{op:'filter',filter:'priority',value:'*'},
    {op:'reload'},{op:'expect',record:'first',fields},
    {op:'reject_save',mutation:{op:'create',record:'failed',values:{customer:'Audit',title:'Rejected create',category:'Feature'}}},
  );
  return {version:1,display:kind==='book'?{borrower:{empty:'On the shelf',format:'Lent to {value}'}}:{status:{values:{in_progress:'In progress'}}},
    filters:kind==='book'?[{id:'lent',field:'borrower',kind:'present'}]:[{id:'status',field:'status',kind:'equals'},{id:'priority',field:'priority',kind:'equals'}],
    counts:kind==='book'?[{id:'lent',where:{present:['borrower']}}]:[{id:'active',where:{},exclude:{equals:{status:'shipped'}}}, {id:'shipped',where:{equals:{status:'shipped'}}}],
    journeys:[{id:'journey_product',steps}],unsupported:[]};
}
