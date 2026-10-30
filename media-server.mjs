import express from 'express';
import {alignClipWords,clipSentences} from './clip-alignment.mjs';
// ECL Song lyrics and short Clips scripts. No music service connected yet.
const LANG={nl:'Belgian Dutch (natural Flemish)',fr:'French',en:'English'};
const recent=new Map();
function clean(s,max=110){return String(s||'').replace(/\s+/g,' ').trim().slice(0,max)}
// Fast independent guard. A second AI editor checks the full language and
// fixes false friends, but obvious English/French/Dutch sentences must still
// be rejected server-side rather than saved or spoken.
const FOREIGN_EN = new Set(('i my your their our them they the and with because '+
  'from this that these those what which who why where when about '+
  'would could should will were are does did dont didn thought '+
  'there here today tomorrow yesterday together always never anything '+
  'everything something everyone someone anybody people every '+
  'then than also very much often please thanks hello good morning '+
  'after before during while work working learning learned learning '+
  'beautiful great interesting important understand understand can '+
  'however therefore although different going want wanted need '+
  'needs have having had has').split(/\s+/));
const FOREIGN_NL = new Set(('ik jij wij zij mijn jouw onze niet het een '+
  'maar want omdat vandaag morgen gisteren graag leuk goed '+
  'hebben heeft gaan kunnen zullen misschien altijd nooit '+
  'daar hier samen leren spreken luisteren werken veel weinig '+
  'waarom wanneer welke hoeveel wie hoe').split(/\s+/));
const FOREIGN_FR = new Set(('nous vous avec aujourd demain pourquoi parce '+
  'bonjour merci beaucoup maintenant toujours jamais vraiment '+
  'suis êtes avons avez allez bien très voilà '+
  'quand comment chez souvent encore ensemble parler travail').split(/\s+/));
function foreignSentences(text,language){
  const pieces=clipSentences(String(text||'')).map(x=>x.text);
  const foreign=language==='nl'?[FOREIGN_EN,FOREIGN_FR]:
    language==='fr'?[FOREIGN_EN,FOREIGN_NL]:
      [FOREIGN_NL,FOREIGN_FR];
  return pieces.filter(line=>{
    const tokens=(line.toLocaleLowerCase().match(/[\p{L}]+/gu)||[]);
    if(tokens.length<2)return false;
    // Avoid rejecting shared loanwords (e.g. "meeting") or isolated proper
    // names. One strong marker or several foreign function words is enough.
    const en=tokens.filter(t=>FOREIGN_EN.has(t)&&
      !['can','good','work','important'].includes(t)).length;
    const nl=tokens.filter(t=>FOREIGN_NL.has(t)&&t!=='hoe').length;
    const fr=tokens.filter(t=>FOREIGN_FR.has(t)).length;
    const counts={nl:[en,fr],fr:[en,nl],en:[nl,fr]}[language]||[];
    const highSignalEnglish=tokens.some(t=>['the','and','because','your','their',
      'would','could','should','there','where','which','those','these','about'].includes(t));
    // For Dutch, "je" and "de" are shared with French, therefore excluded.
    return counts.some(c=>c>=2)||(language!=='en'&&en>=1&&highSignalEnglish);
  });
}
async function mediaJson(apiKey,system,user,{temperature=.4,maxTokens=1600}={}){
  const response=await fetch('https://api.openai.com/v1/chat/completions',{
    method:'POST',
    headers:{Authorization:'Bearer '+apiKey,'Content-Type':'application/json'},
    signal:AbortSignal.timeout(50000),
    body:JSON.stringify({model:'gpt-4o-mini',temperature,
      response_format:{type:'json_object'},max_tokens:maxTokens,
      messages:[{role:'system',content:system},{role:'user',content:JSON.stringify(user)}]})
  });
  if(!response.ok)throw new Error('Media generation HTTP '+response.status);
  const raw=await response.json();
  return JSON.parse(raw.choices?.[0]?.message?.content||'{}');
}

export function registerMediaRoutes(app){

  // Existing videos and new Clips both use their ACTUAL recorded speech.
  // No transcoding, source deletion or Anam re-recording is required.
  const captionRate=new Map();
  // English translation also works when an older video is too large or
  // unsupported for automatic speech alignment. It never modifies the video.
  const translationRate=new Map();
  app.post('/study-clip-translate',async(req,res)=>{
    res.set('Cache-Control','no-store');
    const language=Object.hasOwn(LANG,req.body?.language)?req.body.language:'nl';
    const script=String(req.body?.text||'').trim().slice(0,4200);
    if(!script||script.length<20)return res.status(400).json({error:'Saved clip script missing.'});
    const sentences=clipSentences(script);
    if(language==='en')return res.json({sentences:sentences.map(x=>({...x,english:''}))});
    if(!process.env.OPENAI_API_KEY)return res.status(503).json({error:'Translation API is not configured.'});
    const ip=req.ip||'anonymous',now=Date.now();
    const attempts=(translationRate.get(ip)||[]).filter(x=>now-x<15*60000);
    if(attempts.length>=15)return res.status(429).json({error:'Caption translation limit reached.'});
    attempts.push(now);translationRate.set(ip,attempts);
    if(translationRate.size>400)translationRate.clear();
    try{
      const response=await fetch('https://api.openai.com/v1/chat/completions',{
        method:'POST',
        headers:{Authorization:'Bearer '+process.env.OPENAI_API_KEY,'Content-Type':'application/json'},
        signal:AbortSignal.timeout(45000),
        body:JSON.stringify({model:'gpt-4o-mini',temperature:0,
          response_format:{type:'json_object'},max_tokens:1700,
          messages:[
            {role:'system',content:'Translate every supplied Dutch/Flemish or French sentence into natural, faithful English. Return JSON {"english":["..."]} with exactly the same number of sentences and in the same order. Never omit, merge or invent a sentence.'},
            {role:'user',content:JSON.stringify({language,sentences:sentences.map(x=>x.text)})}
          ]})
      });
      if(!response.ok)throw new Error('Translation HTTP '+response.status);
      const content=(await response.json()).choices?.[0]?.message?.content||'{}';
      const english=JSON.parse(content).english;
      if(!Array.isArray(english)||english.length!==sentences.length)
        throw new Error('Incomplete sentence translation');
      res.json({sentences:sentences.map((x,i)=>({...x,english:String(english[i]||'').trim().slice(0,360)}))});
    }catch(error){
      console.warn('Clip translation failed:',error?.message||error);
      res.status(502).json({error:'English subtitle translation unavailable right now.'});
    }
  });

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
    const captionsAlreadyAvailable=req.headers['x-clip-translations-ready']==='1';
    const translationTask=language==='en'||captionsAlreadyAvailable?
      Promise.resolve([]):
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
    try{
      if(kind==='song'){
        const system=[
          'Create ORIGINAL, short, singable educational lyrics exclusively in '+LANG[language]+'.',
          'All lyrics, heading, verses and chorus must be in the selected language, NOT English unless English is selected.',
          'Use selected vocabulary naturally, with a recurring chorus. 3 verse/chorus sections maximum.',
          'Never imitate particular artists or copyrighted songs.',
          'Return JSON {"title":"...","text":"...","usedWords":["..."]}. No translations or markdown.'
        ].join(' ');
        const result=await mediaJson(process.env.OPENAI_API_KEY,system,
          {theme,genre,words:words.map(x=>x.word)},{temperature:.55,maxTokens:1450});
        const text=String(result.text||'').trim().slice(0,4200);
        if(text.length<50)throw new Error('Song lyrics are too short');
        return res.json({title:clean(result.title,100)||theme,text,usedWords:
          words.filter(w=>text.toLocaleLowerCase().includes(w.word.toLocaleLowerCase())),
          language,theme,genre,kind});
      }
      const langName=LANG[language],savedWords=words.map(w=>w.word);
      // Phase 1: the writing model NEVER sees the English word definitions
      // and NEVER produces English translations in the same JSON request.
      // That separation is vital for Dutch and French language purity.
      const drafting=[
        'You are a native '+langName+' magazine writer and language educator.',
        'MANDATORY LANGUAGE LOCK: ALL words of the title and ALL sentences of "text" MUST be written ONLY in '+langName+'.',
        language==='nl'?
          'DUTCH / VLAAMS ONLY: never write any English sentences, English phrases or French sentences. Use correct Dutch syntax and Dutch verbs in every single sentence.':
          language==='fr'?
            'FRANÇAIS UNIQUEMENT: chaque phrase, titre, transition et expression doit être entièrement en français. Aucune phrase anglaise ou néerlandaise.':
            'ENGLISH ONLY: every sentence must be fully in English, without Dutch or French.',
        'Write a cohesive, natural 110–130 word, approximately one-minute monologue, in 12–17 full sentences.',
        'Use the supplied vocabulary as naturally as possible while keeping every sentence grammatically correct.',
        'The vocabulary list contains words ONLY in the selected language; never translate the words in this output.',
        'Do NOT add translations, examples in another language, bilingual dialogue, explanations, commentary, headings inside text, markdown, labels or stage directions.',
        'Write one completely fresh story on the supplied theme.',
        'Return ONLY JSON {"title":"native-language title","text":"native-language monologue"}.',
        'Before responding, inspect every sentence for foreign-language words or grammar and rewrite them into the requested language.'
      ].join(' ');
      const audit=[
        'You are an exceptionally strict independent '+langName+' native-language copy editor.',
        'Your task is LANGUAGE VERIFICATION AND REPAIR of a one-minute learning clip.',
        'Rewrite the provided draft into 100% '+langName+' while keeping its meaning and selected target-language vocabulary.',
        language==='nl'?
          'Every complete sentence must use Dutch/Flemish words and grammar. Translate any English/French sentence COMPLETELY into natural Dutch. No English sentences anywhere.':
          language==='fr'?
            'Chaque phrase doit être entièrement en français. Traduisez toute phrase anglaise/néerlandaise en français naturel. Aucun anglais dans le texte ni dans le titre.':
            'Use fully English sentences throughout, converting Dutch/French sentences to English.',
        'The title also must be in the requested target language.',
        'Be especially suspicious of hidden English sentences in the middle and the final paragraph.',
        'Keep this one connected natural spoken story of approximately 110–130 words (minimum 85).',
        'NEVER provide English translations or bilingual content in this step.',
        'Return STRICT JSON {"title":"corrected title","text":"corrected full monologue","checkedLanguage":"'+language+'","valid":true}.',
        'Only set valid true after the entire title and text have been corrected into the required language.'
      ].join(' ');
      let verified=null;
      for(let attempt=0;attempt<3;attempt++){
        const draft=await mediaJson(process.env.OPENAI_API_KEY,drafting+
          (attempt?' IMPORTANT: Previous output contained foreign-language sentences. Do NOT write English inside Dutch or French. Write every sentence correctly.':''),
          {language,theme,selectedVocabulary:savedWords,
            previousTopic:previousTitle||'',previousStoryAvoid:previousText?
              'Choose a different plot and different wording from the previous script.':''},
          {temperature:.38,maxTokens:1350});
        const edited=await mediaJson(process.env.OPENAI_API_KEY,audit,
          {targetLanguage:language,theme,selectedVocabulary:savedWords,
            title:String(draft.title||''),text:String(draft.text||'')},
          {temperature:0,maxTokens:1500});
        const text=String(edited.text||'').trim().slice(0,4200);
        const title=clean(edited.title,100);
        const count=clipTokens(text).length;
        const problems=[...foreignSentences(text,language),...foreignSentences(title,language)];
        if(edited.checkedLanguage===language&&edited.valid===true&&
          count>=85&&count<=190&&title.length>=4&&problems.length===0){
          verified={title,text};break;
        }
        console.warn('Rejected mixed-language Clip script:',{
          language,attempt:attempt+1,wordCount:count,
          unexpected:problems.length,verified:edited.checkedLanguage===language&&edited.valid===true
        });
      }
      if(!verified){
        return res.status(422).json({error:
          'The script failed the '+LANG[language]+' language check. Nothing was saved or sent to the avatar. Press Prepare to retry.'});
      }
      const originals=clipSentences(verified.text);
      // Phase 3: only AFTER the target script passes the language audit,
      // translate the immutable script separately into English subtitles.
      let english=[];
      if(language!=='en'){
        try{
          const result=await mediaJson(process.env.OPENAI_API_KEY,[
            'Translate each provided '+langName+' sentence into natural English.',
            'Return ONLY JSON {"english":["..."]} with exactly '+originals.length+' items, one per original sentence in order.',
            'NEVER change the original text, do not supply the original language inside an English translation.',
            'Keep sentence meaning and timing, no extra text.'
          ].join(' '),{sentences:originals.map(x=>x.text),language},
          {temperature:0,maxTokens:1900});
          if(Array.isArray(result.english)&&result.english.length===originals.length)
            english=result.english.map(x=>clean(x,320));
        }catch(error){
          // The validated original is still safe: captions can be translated
          // later through /study-clip-translate without rewriting the script.
          console.warn('English captions pending:',error.message);
        }
      }
      const captionSentences=originals.map((part,i)=>({...part,english:english[i]||''}));
      const normalized=words.filter(w=>
        verified.text.toLocaleLowerCase().includes(w.word.toLocaleLowerCase()));
      return res.json({
        title:verified.title,text:verified.text,usedWords:normalized,
        language,languageValidated:true,validationVersion:2,
        theme,genre,kind,captionSentences
      });
    }catch(error){
      console.warn('Media script generation:',error?.message||error);
      res.status(502).json({error:
        'Clip preparation could not pass language verification. Nothing was saved. Please press Prepare again.'});
    }
  });
}
