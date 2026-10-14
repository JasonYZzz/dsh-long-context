import {mkdir,writeFile} from 'node:fs/promises';
import {join} from 'node:path';
import {createHash} from 'node:crypto';
import {project,workspace} from './runtime.mjs';
const sourceDir=join(workspace,'fixtures'),goldDir=join(project,'evaluation','gold');await mkdir(sourceDir,{recursive:true});await mkdir(goldDir,{recursive:true});
const fixtures=[];
for(let document=0;document<10;document++){
  let text='',offset=0;const changes=[],keep=[];
  const append=line=>{text+=line;offset+=Array.from(line).length;};
  for(let page=0;page<100;page++){
    append(`# 文档 ${document+1} · 第 ${page+1} 页\n`);
    for(let line=0;line<29;line++){
      const prefix=`记录 ${page+1}.${line+1}：`;
      const current=(page+document)%7===0&&line===10;
      const historical=line===15;
      const paraphrase=(page+document)%11===0&&line===20;
      if(current||paraphrase){const quote=current?'当前阈值为10。':'只要达到十个单位，现行方法就接受样本。',replacement=current?'当前阈值为20。':'只要达到二十个单位，现行方法就接受样本。';
        append(prefix);const start=offset;append(quote);changes.push({start,end:offset,expectedOriginal:quote,replacement,page:page+1});append('\n');}
      else if(historical){append(prefix);const start=offset,quote='历史研究的阈值为10，保持引用不变。';append(quote);keep.push({start,end:offset,quote,page:page+1});append('\n');}
      else append(`${prefix}本段记录与主题无关的观察，保留公式 $x_${line}=y$ 和参考说明。😀\n`);
    }append('\f');
  }
  const sourceName=`document-${document+1}.md`,sourcePath=join(sourceDir,sourceName),sourceHash=createHash('sha256').update(text).digest('hex');
  await writeFile(sourcePath,text);const gold={schemaVersion:1,sourceHash,sourceName,pages:100,lines:3000,codePoints:offset,changes,keep,criticalDependencies:[],task:'将现行方法的阈值从10改为20，包括无关键词的同义表述，保留历史引用和其他内容。',humanGoldReview:'not-run'};
  await writeFile(join(goldDir,`document-${document+1}.json`),JSON.stringify(gold,null,2));fixtures.push({sourcePath,sourceHash,pages:100,codePoints:offset,requiredChanges:changes.length,protectedItems:keep.length});
}
await writeFile(join(goldDir,'manifest.json'),JSON.stringify({fixtures,independentHumanReview:'not-run',note:'Generated gold is outside model workspace; model must never receive this folder'},null,2));
console.log(JSON.stringify({documents:fixtures.length,pagesEach:100,sources:sourceDir,gold:goldDir,goldReview:'not-run'}));
