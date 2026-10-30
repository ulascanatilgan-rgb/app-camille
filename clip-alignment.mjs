// Word-aligned subtitles derived from the recorded video sound, not
// equal-duration guesses. Pure functions shared by server and browser.
export const clipTokens=text=>String(text||'').trim().split(/\s+/).filter(Boolean);
const canonical=text=>String(text||'').normalize('NFD').replace(/\p{M}/gu,'')
  .replace(/[^\p{L}\p{N}]/gu,'').toLocaleLowerCase();
export function clipSentences(script){
  const words=clipTokens(script),result=[];
  let start=0;
  // Segment by COMPLETE whitespace tokens. Never create or discard script
  // words (e.g., abbreviations like "e.g." or decimal numbers).
  for(let i=0;i<words.length;i++){
    const stop=/[.!?。！？][”"'’»)]?$/.test(words[i])||i===words.length-1;
    if(!stop)continue;
    result.push({text:words.slice(start,i+1).join(' '),
      startToken:start,endToken:i+1});
    start=i+1;
  }
  return result;
}
export function alignClipWords(script,transcribed,{duration=0}={}){
  const tokens=clipTokens(script),heard=(Array.isArray(transcribed)?transcribed:[])
    .filter(w=>typeof w?.word==='string'&&Number.isFinite(Number(w.start))&&Number.isFinite(Number(w.end)))
    .map(w=>({word:canonical(w.word),start:Math.max(0,Number(w.start)),end:Math.max(0,Number(w.end))}))
    .filter(w=>w.word&&w.end>=w.start);
  if(!tokens.length||!heard.length)return {aligned:false,confidence:0,wordTimes:[]};
  const words=tokens.map(canonical),n=words.length,m=heard.length;
  // LCS alignment handles pauses, short skipped words and repeated words.
  const dp=Array.from({length:n+1},()=>new Uint16Array(m+1));
  for(let i=n-1;i>=0;i--)for(let j=m-1;j>=0;j--){
    dp[i][j]=words[i]&&words[i]===heard[j].word?1+dp[i+1][j+1]:
      Math.max(dp[i+1][j],dp[i][j+1]);
  }
  const anchors=[];let i=0,j=0;
  while(i<n&&j<m){
    if(words[i]&&words[i]===heard[j].word){anchors.push([i,j]);i++;j++}
    else if(dp[i+1][j]>=dp[i][j+1])i++;
    else j++;
  }
  const confidence=anchors.length/n;
  if(anchors.length<Math.min(5,n)||confidence<.35)
    return {aligned:false,confidence:Number(confidence.toFixed(3)),wordTimes:[]};
  const times=new Array(n);
  for(const [index,k]of anchors){
    times[index]={start:heard[k].start,end:Math.max(heard[k].start+.055,heard[k].end)};
  }
  for(let index=0;index<n;index++){
    if(times[index])continue;
    let left=index-1;while(left>=0&&!times[left])left--;
    let right=index+1;while(right<n&&!times[right])right++;
    if(left>=0&&right<n){
      const gap=Math.max(.12,times[right].start-times[left].end);
      const span=right-left;
      const a=times[left].end+gap*(index-left-1)/span;
      const b=times[left].end+gap*(index-left)/span;
      times[index]={start:a,end:Math.max(a+.05,b)};
    }else if(right<n){
      const length=right-index;
      const start=Math.max(0,times[right].start-length*.22);
      times[index]={start,end:Math.max(start+.06,times[right].start-.025)};
    }else if(left>=0){
      const start=times[left].end+.035;
      const finish=duration>start?Math.min(duration,start+.25):start+.2;
      times[index]={start,end:finish};
    }
  }
  for(let k=1;k<times.length;k++){
    times[k].start=Math.max(times[k].start,times[k-1].start+.012);
    times[k].end=Math.max(times[k].start+.045,times[k].end);
  }
  return {aligned:true,confidence:Number(confidence.toFixed(3)),
    wordTimes:times.map(x=>({start:+x.start.toFixed(3),end:+x.end.toFixed(3)}))};
}
