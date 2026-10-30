import express from 'express';
import {alignClipWords,clipSentences} from './clip-alignment.mjs';
// ECL Song lyrics and short Clips scripts. No music service connected yet.
const LANG={nl:'Belgian Dutch (natural Flemish)',fr:'French',en:'English'};
const recent=new Map();
function clean(s,max=110){return String(s||'').replace(/\s+/g,' ').trim().slice(0,max)}
export function registerMediaRoutes(app){

  // Existing videos and new Clips both use their ACTUAL recorded speech.
  // No transcoding, source deletion or Anam re-recording is required.
  const captionRate=new Map();
  app.post('/study-clip-align',express.raw({type:'application/octet-stream',limit:'24mb'}),async(req,res)=>{
    res.set('Cache-Control','no-store');
    if(!process.env.OPENAI_API_KEY)
      return res.status(503).json({error:'Speech alignment is not configured on the server.'});
    const language=Object.hasOwn(LANG,req.headers['x-clip-language'])?
      req.headers['x-clip-language']:'nl';
    let script='';
    try{script=decodeURIComponent(String(req.headers['x-clip-script']||'')).trim();}
    catch{return res.status(400).json({error:'Invalid script encoding.'});}
    const format=req.headers['x-clip-format']==='mp4'?'mp4':'webm';
    const bytes=req.body;
    if(!Buffer.isBuffer(bytes)||bytes.length<4000||bytes.length>24*1024*1024||
      !script||script.length>3800)
      return res.status(400).json({error:'Invalid recording or script for alignment.'});
    const ip=req.ip||'anonymous',now=Date.now();
    const history=(captionRate.get(ip)||[]).filter(x=>now-x<15*60000);
    if(history.length>=12)return res.status(429).json({error:'Too many subtitle alignments. Retry later.'});
    history.push(now);captionRate.set(ip,history);
    if(captionRate.size>500)captionRate.clear();
    const sentences=clipSentences(script);
    const transcriptTask=(async()=>{
      const form=new FormData();
      form.append('file',new Blob([bytes],{type:format==='mp4'?'video/mp4':'video/webm'}),'clip.'+format);
      form.append('model','whisper-1');
      form.append('response_format','verbose_json');
      form.append('timestamp_granularities[]','word');
      form.append('language',language);
      form.append('prompt',script.slice(0,900));
      const response=await fetch('https://api.openai.com/v1/audio/transcriptions',{
        method:'POST',headers:{Authorization:'Bearer '+process.env.OPENAI_API_KEY},
        body:form,signal:AbortSignal.timeout(80000)
      });
      if(!response.ok)throw new Error('Speech alignment API HTTP '+response.status);
      const result=await response.json();
      return {words:Array.isArray(result.words)?result.words:[],
        duration:Number(result.duration)||0};
    })();
    const translationTask=language==='en'?Promise.resolve(sentences.map(x=>x.text)):
      (async()=>{
        const response=await fetch('https://api.openai.com/v1/chat/completions',{
          method:'POST',headers:{Authorization:'Bearer '+process.env.OPENAI_API_KEY,
            'Content-Type':'application/json'},
          signal:AbortSignal.timeout(45000),
          body:JSON.stringify({model:'gpt-4o-mini',temperature:0,
            response_format:{type:'json_object'},max_tokens:1600,
            messages:[{role:'system',content:
              'Translate each French or Flemish/Dutch sentence faithfully into natural concise English. '+
              'Return ONLY {"english":["..."]}. Preserve the exact sentence count, meaning, ordering and tense. '+
              'No added examples, rephrasing or explanations.'},
              {role:'user',content:JSON.stringify({
                language,originalSentences:sentences.map(x=>x.text)})}]
          })
        });
        if(!response.ok)throw new Error('Translation API HTTP '+response.status);
        const obj=JSON.parse((await response.json()).choices?.[0]?.message?.content||'{}');
        const english=obj.english;
        return Array.isArray(english)&&english.length===sentences.length?
          english.map(x=>String(x||'').trim().slice(0,380)):[];
      })();
    const [audio,translations]=await Promise.allSettled([transcriptTask,translationTask]);
    const timeline=audio.status==='fulfilled'?
      alignClipWords(script,audio.value.words,{duration:audio.value.duration}):
      {aligned:false,confidence:0,wordTimes:[]};
    const english=translations.status==='fulfilled'?translations.value:[];
    const bilingual=sentences.map((sentence,i)=>({...sentence,english:english[i]||''}));
    if(audio.status==='rejected')console.warn('Clip audio alignment:',audio.reason?.message||audio.reason);
    if(translations.status==='rejected')console.warn('Clip translation:',translations.reason?.message||translations.reason);
    if(!timeline.aligned&&!english.length)
      return res.status(502).json({error:'Could not align this video or translate its script. Retry Sync subtitles.'});
    return res.json({
      aligned:timeline.aligned,confidence:timeline.confidence,
      wordTimes:timeline.wordTimes,sentences:bilingual,
      method:timeline.aligned?'recorded-speech-word-timestamps':'translation-only'
    });
  });
  app.post('/study-media-script',async(req,res)=>{
    res.set('Cache-Control','no-store');
    if(!process.env.OPENAI_API_KEY)return res.status(503).json({error:'Text generation is not configured.'});
    const kind=req.body?.kind==='song'?'song':'clip';
    const language=Object.hasOwn(LANG,req.body?.language)?req.body.language:'nl';
    const theme=clean(req.body?.theme,65)||'Daily life';
    const genre=clean(req.body?.genre,35)||'Pop';
    const previousTitle=kind==='clip'?clean(req.body?.previousTitle,100):'';
    const previousText=kind==='clip'?clean(req.body?.previousText,650):'';
    const words=(Array.isArray(req.body?.words)?req.body.words:[]).slice(0,24)
      .map(x=>({word:clean(x?.word,55),english:clean(x?.english,90)}))
      .filter(x=>x.word&&x.english);
    if(words.length<1)return res.status(400).json({error:'Learn words in Talk first.'});
    const ip=req.ip||'anonymous', now=Date.now();
    const attempts=(recent.get(ip)||[]).filter(t=>now-t<3600000);
    if(attempts.length>=20)return res.status(429).json({error:'Content creation limit reached. Please try again later.'});
    attempts.push(now);recent.set(ip,attempts);
    const system=[
      'You write ORIGINAL copyright-safe educational material for language learners.',
      'Target language is '+LANG[language]+'. NEVER mix French and Dutch.',
      'The user supplies vocabulary with English translations.',
      kind==='clip'?
        'Create ONE fresh, ORIGINAL one-person spoken monologue for an avatar, about 110-130 words lasting around 60 seconds at a calm speaking pace. Incorporate ALL the supplied selected vocabulary (up to 20), naturally and grammatically, with one cohesive story rather than a word list. Prefer everyday B1 language, fluid short sentences and a fresh angle each time even for identical inputs. No dialogue labels, stage directions or markdown.':
        'Write an ORIGINAL, short, singable, easy-to-understand song lyric, including a recurring chorus, in the requested genre '+genre+'. Use 15-20 input vocabulary items when available; for fewer words, use all naturally. Repetition helps memorization. 3 verses/chorus sections maximum. Do not imitate specific artists or copyrighted songs.',
      'Return ONLY JSON {"title":"...","text":"...","usedWords":["..."]}.',
      'The text and title must be solely in the target language. Use newline breaks for song verses.',
      'Only put words actually used in text in usedWords. No explanation, no adult or unsafe themes.',
      kind==='clip'&&previousText?'The user previously received a clip script. Write a clearly DIFFERENT narrative, setting and sentence order, without reusing earlier sentences.':''
    ].join(' ');
    try{
      const resp=await fetch('https://api.openai.com/v1/chat/completions',{
        method:'POST',headers:{'Authorization':'Bearer '+process.env.OPENAI_API_KEY,'Content-Type':'application/json'},
        signal:AbortSignal.timeout(55000),
        body:JSON.stringify({
          model:'gpt-4o-mini',temperature:kind==='clip' ? 0.85 : 0.55,response_format:{type:'json_object'},max_tokens:1450,
          messages:[{role:'system',content:system},{role:'user',content:JSON.stringify({theme,genre,words,previousTitle,previousText})}]
        })
      });
      if(!resp.ok)throw new Error('Script generation returned HTTP '+resp.status);
      const raw=await resp.json();
      const obj=JSON.parse(raw.choices?.[0]?.message?.content||'{}');
      const text=String(obj.text||'').trim().slice(0,4200);
      if(text.length<65)throw new Error('The resulting script was too short.');
      const title=clean(obj.title,100)||theme;
      const normalized=words.filter(w=>text.toLocaleLowerCase().includes(w.word.toLocaleLowerCase()));
      res.json({title,text,usedWords:normalized,language,theme,genre,kind});
    }catch(e){
      console.warn('Media script generation:',e.message);
      res.status(502).json({error:'Could not create this text right now. Please retry.'});
    }
  });
}
