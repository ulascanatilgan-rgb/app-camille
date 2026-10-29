// ECL Song lyrics and short Clips scripts. No music service connected yet.
const LANG={nl:'Belgian Dutch (natural Flemish)',fr:'French',en:'English'};
const recent=new Map();
function clean(s,max=110){return String(s||'').replace(/\s+/g,' ').trim().slice(0,max)}
export function registerMediaRoutes(app){
  app.post('/study-media-script',async(req,res)=>{
    res.set('Cache-Control','no-store');
    if(!process.env.OPENAI_API_KEY)return res.status(503).json({error:'Text generation is not configured.'});
    const kind=req.body?.kind==='song'?'song':'clip';
    const language=Object.hasOwn(LANG,req.body?.language)?req.body.language:'nl';
    const theme=clean(req.body?.theme,65)||'Daily life';
    const genre=clean(req.body?.genre,35)||'Pop';
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
      'Only put words actually used in text in usedWords. No explanation, no adult or unsafe themes.'
    ].join(' ');
    try{
      const resp=await fetch('https://api.openai.com/v1/chat/completions',{
        method:'POST',headers:{'Authorization':'Bearer '+process.env.OPENAI_API_KEY,'Content-Type':'application/json'},
        signal:AbortSignal.timeout(55000),
        body:JSON.stringify({
          model:'gpt-4o-mini',temperature:kind==='clip'?.85:.55,response_format:{type:'json_object'},max_tokens:1450,
          messages:[{role:'system',content:system},{role:'user',content:JSON.stringify({theme,genre,words})}]
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
