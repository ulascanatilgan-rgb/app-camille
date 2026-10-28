// ECL Slide + News study routes. The browser only receives original
// educational summaries and links to their cited news sources.
const LANGUAGE = {
  fr:{name:'French',locale:'fr-FR',region:'FR',edition:'FR:fr'},
  nl:{name:'Belgian Dutch/Flemish',locale:'nl-BE',region:'BE',edition:'BE:nl'},
  en:{name:'English',locale:'en-GB',region:'GB',edition:'GB:en'}
};
const inMemoryNews = new Map();
function safeText(value,max=350) {return String(value||'').replace(/<[^>]*>/g,' ').replace(/\s+/g,' ').trim().slice(0,max)}
function decodeXml(s) {
  return String(s||'').replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g,'$1')
    .replace(/&#x([a-f0-9]+);/gi,(_,v)=>String.fromCodePoint(parseInt(v,16)))
    .replace(/&#([0-9]+);/g,(_,v)=>String.fromCodePoint(parseInt(v,10)))
    .replace(/&amp;/g,'&').replace(/&quot;/g,'"')
    .replace(/&apos;|&#39;/g,"'").replace(/&lt;/g,'<').replace(/&gt;/g,'>');
}
function tag(body,name) {
  const match=body.match(new RegExp('<'+name+'(?:\\s[^>]*)?>([\\s\\S]*?)<\\/'+name+'>','i'));
  return match?decodeXml(match[1]):'';
}
function cleanArticleHref(value) {
  try {
    const u=new URL(value);
    return ['https:','http:'].includes(u.protocol)?u.toString():'';
  }catch{return ''}
}
function findFeeds(xml) {
  const parts=[...xml.matchAll(/<item\b[^>]*>([\s\S]*?)<\/item>/gi)];
  return parts.map(([,body])=>{
    const headline=safeText(decodeXml(tag(body,'title')),200);
    const link=cleanArticleHref(tag(body,'link').trim());
    const description=safeText(decodeXml(tag(body,'description')),450);
    const source=safeText(tag(body,'source'),95);
    const pubDate=tag(body,'pubDate');
    return {headline,link,description,source, publishedAt:Number.isFinite(Date.parse(pubDate))?new Date(pubDate).toISOString():null};
  }).filter(x=>x.headline&&x.link);
}
// Read public source pages only as factual reference material; never copy
// source articles to ECL users. Some sites restrict scraping, so RSS-only
// fallback must always remain usable.
async function sourceContext(article){
  try{
    const address=new URL(article.link);
    if(!['https:','http:'].includes(address.protocol) ||
      /(^|\.)news\.google\.com$/i.test(address.hostname))return '';
    const response=await fetch(address.toString(),{
      headers:{'User-Agent':'Mozilla/5.0 (compatible; ECL-learning-reader/1.0)',
        'Accept':'text/html,application/xhtml+xml'},
      signal:AbortSignal.timeout(7000)
    });
    if(!response.ok||!(response.headers.get('content-type')||'').includes('text/html'))return '';
    const html=(await response.text()).slice(0,450000);
    const clean=value=>safeText(decodeXml(String(value).replace(/<[^>]*>/g,' ')),4700);
    const ld=html.match(/"articleBody"\s*:\s*"((?:\\.|[^"\\])*)"/i);
    if(ld){
      try{
        const value=JSON.parse('"'+ld[1]+'"');
        return clean(value).slice(0,4500);
      }catch{}
    }
    const main=html.match(/<article\b[^>]*>([\s\S]*?)<\/article>/i)||
      html.match(/<main\b[^>]*>([\s\S]*?)<\/main>/i);
    if(!main)return '';
    const body=main[1].replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi,'')
      .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi,'');
    const paragraphs=[...body.matchAll(/<p\b[^>]*>([\s\S]*?)<\/p>/gi)]
      .map(item=>clean(item[1])).filter(item=>item.length>60).slice(0,14);
    return paragraphs.join(' ').slice(0,4500);
  }catch{return ''}
}
function getDay() {return new Date().toISOString().slice(0,10)}
function isValidWord(word) {return typeof word==='string'&&word.length>=1&&word.length<=60&&/\p{Script=Latin}/u.test(word)}
async function jsonFromOpenAI(apiKey,system,user,maxTokens=3400) {
  const response=await fetch('https://api.openai.com/v1/chat/completions',{
    method:'POST',
    headers:{'Content-Type':'application/json',Authorization:'Bearer '+apiKey},
    signal:AbortSignal.timeout(70000),
    body:JSON.stringify({
      model:'gpt-4o-mini',
      temperature:0.25,
      response_format:{type:'json_object'},
      max_tokens:maxTokens,
      messages:[{role:'system',content:system},{role:'user',content:user}]
    })
  });
  if(!response.ok)throw new Error('OpenAI learning content request failed: HTTP '+response.status);
  const data=await response.json();
  return JSON.parse(data?.choices?.[0]?.message?.content||'{}');
}
export function registerStudyRoutes(app) {
  app.post('/study-slide-deck',async(req,res)=>{
    res.setHeader('Cache-Control','no-store');
    if(!process.env.OPENAI_API_KEY)return res.status(503).json({error:'OpenAI API key not configured.'});
    const language=LANGUAGE[req.body?.language]?req.body.language:'nl';
    const input=Array.isArray(req.body?.words)?req.body.words:[];
    const words=input.slice(0,24).map(w=>({
      id:safeText(w?.id,100),word:safeText(w?.word,65),meaning:safeText(w?.meaning,100)
    })).filter(w=>w.id&&isValidWord(w.word));
    if(!words.length)return res.json({cards:[]});
    try{
      const system=[
        'Create swipe-learning cloze cards in '+LANGUAGE[language].name+'.',
        'Each card must test exactly the given word (not a synonym).',
        'Definition: a helpful SIMPLE ENGLISH explanation for a learner, WITHOUT writing the answer word, 7-16 words. ALWAYS use ENGLISH even when the tested word is French or Dutch.',
        'Sentence: a NATURAL sentence in the target language, 7-10 words total, with the EXACT answer replaced by literal ____ (one blank).',
        'The missing word must fit grammatically as-is, including when the word is a multiword expression.',
        'wrong: ONE unrelated but plausible different word IN THE TARGET LANGUAGE, never the correct word.',
        'Return one card for each input word; preserve exact input id, word.',
        'The definition MUST be in English. The sample sentence and wrong option MUST be in the target language only.',
        'JSON ONLY {"cards":[{"id":"...","definition":"...","sentence":"... ____ ...","wrong":"..."}]}'
      ].join(' ');
      const result=await jsonFromOpenAI(process.env.OPENAI_API_KEY,system,JSON.stringify({language,words}),3600);
      const expected=new Map(words.map(w=>[w.id,w]));
      const cards=(Array.isArray(result.cards)?result.cards:[]).map(c=>{
        const w=expected.get(String(c?.id));
        if(!w)return null;
        const definition=safeText(c.definition,260),sentence=safeText(c.sentence,240),wrong=safeText(c.wrong,65);
        if(!definition||!sentence.includes('____')||sentence.split('____').length!==2||
          !isValidWord(wrong)||wrong.toLowerCase()===w.word.toLowerCase() ||
          !/\p{Script=Latin}/u.test(definition))return null;
        if(definition.toLocaleLowerCase().includes(w.word.toLocaleLowerCase()))return null;
        const count=sentence.trim().split(/\s+/).length;
        if(count<6||count>11)return null;
        return {id:w.id,word:w.word,meaning:w.meaning,definition,sentence,wrong};
      }).filter(Boolean);
      res.json({cards});
    }catch(error){console.error('Slide deck failed:',error);res.status(502).json({error:'Could not generate study cards.'});}
  });
  // A reader can tap ANY article word, not only the ten extracted words.
  // Cache is maintained by the browser; source sentences are bounded.
  app.post('/study-news-word',async(req,res)=>{
    res.setHeader('Cache-Control','no-store');
    if(!process.env.OPENAI_API_KEY)return res.status(503).json({error:'OpenAI API key not configured.'});
    const language=LANGUAGE[req.body?.language]?req.body.language:'nl';
    const word=safeText(req.body?.word,65),sentence=safeText(req.body?.sentence,340);
    if(!isValidWord(word)||!sentence || word.length>65)
      return res.status(400).json({error:'Invalid study word.'});
    try {
      const system=[
        'You teach vocabulary in '+LANGUAGE[language].name+'.',
        'Given a word and its short sentence, identify the sense in that sentence.',
        'Return one correct concise English translation, a short, easy explanation IN THE TARGET LANGUAGE,',
        'and one new natural practical example sentence IN THE TARGET LANGUAGE, 6-12 words.',
        'Do not invent factual news claims. Explain the word as used, not the whole article.',
        'JSON ONLY: {"word":"...","english":"...","definition":"...","example":"..."}'
      ].join(' ');
      const data=await jsonFromOpenAI(process.env.OPENAI_API_KEY,system,JSON.stringify({word,sentence,language}),330);
      const result={word,english:safeText(data.english,110),definition:safeText(data.definition,240),
        example:safeText(data.example,240)};
      if(!result.english||!result.definition||!result.example)throw new Error('Incomplete word details');
      return res.json(result);
    }catch(error){
      console.error('News word lookup unavailable:',error);
      return res.status(502).json({error:'Word explanation unavailable. Please retry.'});
    }
  });

  // Natural narrated News, cached once per article per server lifetime.
  // All speech is generated with an AI voice, not a human newsreader.
  const newsAudioCache=new Map();
  const narrationRate=new Map();
  app.post('/study-news-audio',async(req,res)=>{
    res.setHeader('Cache-Control','private, max-age=3600');
    if(!process.env.OPENAI_API_KEY)return res.status(503).json({error:'Voice API not configured.'});
    const language=LANGUAGE[req.body?.language]?req.body.language:'nl';
    const text=safeText(req.body?.text,6500).slice(0,6200);
    const storyId=safeText(req.body?.storyId,140);
    if(text.length<60||!storyId || text.length>6200)return res.status(400).json({error:'Invalid narration request.'});
    const voiceKey=language+':'+storyId+':'+text.length+':'+text.slice(0,38);
    const saved=newsAudioCache.get(voiceKey);
    if(saved){res.type('audio/mpeg');return res.send(saved);}
    // Cap uncached paid syntheses per visitor to prevent accidental high API bills.
    const ip=req.ip||'unknown',now=Date.now();
    const windowed=(narrationRate.get(ip)||[]).filter(time=>now-time<600000);
    if(windowed.length>=9)return res.status(429).json({error:'News narration limit reached. Retry later or use saved audio.'});
    windowed.push(now);narrationRate.set(ip,windowed);
    if(narrationRate.size>500)narrationRate.clear();
    try{
      // Speech endpoint is available currently; migration to Realtime audio
      // is needed before its announced 2027-01-06 retirement.
      const response=await fetch('https://api.openai.com/v1/audio/speech',{
        method:'POST',
        headers:{Authorization:'Bearer '+process.env.OPENAI_API_KEY,'Content-Type':'application/json'},
        signal:AbortSignal.timeout(70000),
        body:JSON.stringify({
          model:'gpt-4o-mini-tts',
          voice:'marin',response_format:'mp3',speed:1.02,
          instructions:'Read this '+LANGUAGE[language].name+' news story with a natural confident, relaxed, modern radio-presenter voice. Smooth connected flow, clear pronunciation, lightly expressive, understated and cool, never robotic or theatrical. Do not add or remove any words.',
          input:text
        })
      });
      if(!response.ok)throw new Error('OpenAI audio response '+response.status);
      const bytes=Buffer.from(await response.arrayBuffer());
      if(bytes.length<1200||bytes.length>12_000_000)throw new Error('Invalid audio size');
      if(newsAudioCache.size>24)newsAudioCache.clear();
      newsAudioCache.set(voiceKey,bytes);
      res.type('audio/mpeg').send(bytes);
    }catch(error){
      console.error('News narration failed:',error?.message||error);
      res.status(502).json({error:'Natural narration unavailable. You can use device speech as a fallback.'});
    }
  });
  app.get('/study-news',async(req,res)=>{
    res.setHeader('Cache-Control','no-store');
    const language=LANGUAGE[req.query?.language]?req.query.language:'nl';
    const key=language+':'+getDay();
    if(inMemoryNews.has(key))return res.json(inMemoryNews.get(key));
    if(!process.env.OPENAI_API_KEY)return res.status(503).json({error:'OpenAI API key not configured.'});
    const cfg=LANGUAGE[language];
    try{
      // Use several public, freely accessible RSS sources with links back to the
      // original publisher. Never copy or republish copyrighted full articles.
      const feedUrls={
        fr:[
          'https://www.france24.com/fr/rss',
          'https://www.francetvinfo.fr/titres.rss',
          'https://www.lemonde.fr/rss/une.xml',
          'https://news.google.com/rss?hl=fr-FR&gl=FR&ceid=FR:fr'
        ],
        nl:[
          'https://www.vrt.be/vrtnieuws/nl.rss.articles.xml',
          'https://www.vrt.be/vrtnws/nl.rss.xml',
          'https://feeds.nos.nl/nosnieuwsalgemeen',
          'https://news.google.com/rss?hl=nl-BE&gl=BE&ceid=BE:nl'
        ],
        en:[
          'https://feeds.bbci.co.uk/news/world/rss.xml',
          'https://www.theguardian.com/world/rss',
          'https://feeds.npr.org/1001/rss.xml',
          'https://news.google.com/rss?hl=en-GB&gl=GB&ceid=GB:en'
        ]
      };
      const feedResults=await Promise.allSettled(feedUrls[language].map(async (url)=>{
        const response=await fetch(url,{headers:{'User-Agent':'ECL-Learning/1.0 (educational RSS reader)','Accept':'application/rss+xml, application/xml, text/xml, */*'},signal:AbortSignal.timeout(11000)});
        if(!response.ok)throw new Error('RSS '+response.status);
        const items=findFeeds(await response.text());
        return items.map(item=>({...item,feed:new URL(url).hostname}));
      }));
      const articles=feedResults.filter(item=>item.status==='fulfilled').flatMap(item=>item.value);
      const seen=new Set();
      // Prefer distinct publishers and topical diversity over just the first feed.
      const unique=articles.filter(item=>{
        const k=item.headline.toLowerCase().replace(/[^\p{L}\p{N}]+/gu,' ').slice(0,65);
        if(seen.has(k))return false;
        seen.add(k);return true;
      });
      const sourceGroups=new Map();
      for(const item of unique){
        const name=(item.source||item.feed||'news').toLowerCase();
        if(!sourceGroups.has(name))sourceGroups.set(name,[]);
        sourceGroups.get(name).push(item);
      }
      const titles=[];
      for(const group of sourceGroups.values()){
        if(titles.length>=3)break;
        if(group[0])titles.push(group[0]);
      }
      for(const item of unique){
        if(titles.length>=3)break;
        if(!titles.includes(item))titles.push(item);
      }
      if(titles.length<3)throw new Error('Not enough public headlines available');
      // Free-access publishers with substantive article text permit more
      // detailed, grounded reports than headlines alone.
      const contexts=await Promise.all(titles.map(sourceContext));
      const facts=titles.map((item,i)=>({...item,backgroundExcerpt:contexts[i]}));
      const system=[
        'You are an engaging international newsroom writer creating ORIGINAL, longer magazine-style educational news articles in '+cfg.name+'.',
        'Use ONLY verifiable facts in the supplied feed headline, publisher, description and date; add clearly signposted general background and explanation, not fabricated event details.',
        'Never invent facts, names, amounts, quotations, prices, dates or developments absent from the supplied facts.',
        'If the headline gives few facts, explain its general context neutrally and explicitly mark uncertainty.',
        'Never reproduce any publisher article or substantial excerpts. Create distinct original educational reporting based on short RSS facts and general context; give the publisher source link.',
        'Create exactly 3 original reports in the supplied order, each 23 to 30 natural sentences totaling about 350–480 words in the target language. Write one coherent article with short paragraphs, not isolated vocabulary drills or bullets.',
        'Each story: its own original target-language title; sentences array of {"target":"...","english":"..."} pairs. Each sentence should flow into the next as a continuous essay.',
        'The english text must be a natural, faithful English translation of the corresponding target sentence.',
        'Each story: exactly 10 useful vocabulary entries, {"word":"...","english":"...","definition":"...","example":"..."}.',
        'definition and example must be in the target language. Example: one practical sentence, no more than 12 words.',
        'Choose genuinely useful terms that actually appear in the target sentences. Avoid names.',
        'Use natural, engaging and readable B1-level reporting, gently introducing new vocabulary; not childish, not clipped. Keep each sentence moderate in length and paragraphs logical.',
        'Do not claim there is up-to-the-minute reporting beyond the supplied feed.',
        'Return JSON {"stories":[{"title":"...","sentences":[{"target":"...","english":"..."}],"words":[{"word":"...","english":"...","definition":"...","example":"..."}]}]}.'
      ].join(' ');
      const generated=await jsonFromOpenAI(process.env.OPENAI_API_KEY,system,JSON.stringify({
        language,day:getDay(),headlines:facts
      }),13000);
      const stories=(Array.isArray(generated.stories)?generated.stories:[]).slice(0,3).map((o,i)=>{
        const source=titles[i];if(!source)return null;
        const sentences=(Array.isArray(o.sentences)?o.sentences:[]).slice(0,34)
          .map(x=>({target:safeText(x?.target,360),english:safeText(x?.english,360)}))
          .filter(x=>x.target&&x.english);
        const words=(Array.isArray(o.words)?o.words:[]).slice(0,10)
          .map(x=>({word:safeText(x?.word,65),english:safeText(x?.english,110),definition:safeText(x?.definition,240),example:safeText(x?.example,240)}))
          .filter(w=>isValidWord(w.word)&&w.english&&w.definition&&w.example);
        if(sentences.length<18||words.length<5)return null;
        return {id:language+'-'+getDay()+'-'+i,title:safeText(o.title,190)||source.headline,
          sourceHeadline:source.headline,source:source.source||'Google News',url:source.link,
          publishedAt:source.publishedAt,sentences,words};
      }).filter(Boolean);
      if(stories.length!==3)throw new Error('News study article response incomplete');
      const data={language,updatedAt:new Date().toISOString(),stories};
      inMemoryNews.set(key,data);
      if(inMemoryNews.size>12)inMemoryNews.clear();
      res.json(data);
    }catch(error){console.error('News study failed:',error);res.status(502).json({error:'Could not load today\'s headlines. Retry Update later.'});}
  });
}
