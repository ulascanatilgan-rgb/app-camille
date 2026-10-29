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
  // Public RSS-only news reader. Never block article loading on an AI model,
  // paid API quota, TTS generation, or scraping the publisher's full article.
  app.get('/study-news',async(req,res)=>{
    res.setHeader('Cache-Control','no-store');
    const language=LANGUAGE[req.query?.language]?req.query.language:'nl';
    const cached=inMemoryNews.get(language);
    const now=Date.now();
    if(req.query?.refresh!=='1'&&cached&&now-cached.fetchedAt<15*60*1000)
      return res.json(cached.data);
    const feedUrls={
      fr:[
        'https://www.france24.com/fr/rss',
        'https://www.francetvinfo.fr/titres.rss',
        'https://www.lemonde.fr/rss/une.xml',
        'https://news.google.com/rss?hl=fr-FR&gl=FR&ceid=FR:fr'
      ],
      nl:[
        'https://www.vrt.be/vrtnieuws/nl.rss.articles.xml',
        'https://feeds.nos.nl/nosnieuwsalgemeen',
        'https://feeds.nos.nl/nosnieuwsbuitenland',
        'https://news.google.com/rss?hl=nl-BE&gl=BE&ceid=BE:nl'
      ],
      en:[
        'https://feeds.bbci.co.uk/news/rss.xml',
        'https://feeds.bbci.co.uk/news/world/rss.xml',
        'https://www.theguardian.com/world/rss',
        'https://www.vrt.be/vrtnws/en.rss.articles.xml',
        'https://news.google.com/rss?hl=en-GB&gl=GB&ceid=GB:en'
      ]
    };
    try{
      const results=await Promise.allSettled(feedUrls[language].map(async url=>{
        const response=await fetch(url,{
          headers:{'User-Agent':'Mozilla/5.0 (compatible; ECL-NewsReader/1.0)',
            'Accept':'application/rss+xml,application/atom+xml,application/xml,text/xml,*/*'},
          signal:AbortSignal.timeout(8500)
        });
        if(!response.ok)throw new Error('Feed HTTP '+response.status);
        const xml=await response.text();
        return findFeeds(xml).map(item=>({...item,feed:new URL(url).hostname}));
      }));
      const entries=results.filter(x=>x.status==='fulfilled').flatMap(x=>x.value);
      const unique=[],seen=new Set();
      for(const entry of entries){
        const normalized=entry.headline.toLocaleLowerCase().replace(/[^\p{L}\p{N}]+/gu,' ').slice(0,90);
        if(!normalized||seen.has(normalized))continue;
        seen.add(normalized);
        unique.push(entry);
      }
      // Each card is a real, independently sourced short public-news brief.
      // Prefer informative RSS summaries, variety of publishers and recent posts.
      const sorted=unique
        .filter(item=>item.link && item.headline && item.description.length>=20)
        .sort((a,b)=>{
          const recentA=Number.isFinite(Date.parse(a.publishedAt))?Date.parse(a.publishedAt):0;
          const recentB=Number.isFinite(Date.parse(b.publishedAt))?Date.parse(b.publishedAt):0;
          return recentB-recentA;
        });
      const choices=[],hosts=new Set();
      for(const item of sorted){
        const host=item.source||item.feed;
        if(hosts.has(host))continue;
        hosts.add(host);choices.push(item);
        if(choices.length===3)break;
      }
      for(const item of sorted){
        if(choices.length===3)break;
        if(!choices.includes(item))choices.push(item);
      }
      if(!choices.length){
        // Some feeds omit descriptions. Still render dated, linked headlines.
        choices.push(...unique.filter(x=>x.link&&x.headline).slice(0,3));
      }
      if(!choices.length)throw new Error('No reachable RSS articles');
      const stories=choices.map((item,i)=>{
        const source=item.source||item.feed||'Public RSS';
        const summary=safeText(item.description,730);
        // Clean, flowing sentences for word-by-word speech highlighting.
        const plain=(summary||item.headline).replace(/\s+/g,' ').trim();
        const chunks=plain.match(/[^.!?…。！？]+(?:[.!?…。！？]+|$)/gu)||[plain];
        const sentences=chunks.map(part=>part.trim()).filter(Boolean)
          .map(target=>({target,english:''}));
        // Feed summaries are provided for syndication; don't copy full articles.
        const detail=sentences.length?sentences:[{target:item.headline,english:''}];
        let hash=5381;
        for(const char of item.link)hash=((hash<<5)+hash)^char.charCodeAt(0);
        return {
          id:language+'-rss-'+(hash>>>0).toString(36),
          kind:'rss',language,title:item.headline,
          sourceHeadline:item.headline,source,
          url:item.link,publishedAt:item.publishedAt,
          sentences:detail,words:[]
        };
      });
      // A half-page front-page briefing combines five SHORT source excerpts,
      // while two individual linked stories remain available as separate cards.
      // Each entry is explicitly attributed; this is a roundup, not a
      // reproduction of the publishers' original articles.
      const digestItems=[...choices];
      for(const item of sorted){
        if(digestItems.length>=5)break;
        if(!digestItems.includes(item))digestItems.push(item);
      }
      if(digestItems.length>=4){
        const titles={
          fr:"L'essentiel de l'actualité",
          nl:"Het belangrijkste nieuws van vandaag",
          en:"Today's news in brief"
        };
        const intro={
          fr:"Voici les principales informations des médias publics et des fils RSS.",
          nl:"Dit zijn recente berichten uit openbare nieuwsbronnen.",
          en:"These are recent reports from freely accessible news sources."
        };
        const excerpts=digestItems.slice(0,5).map(item=>{
          const publisher=item.source||item.feed||'RSS';
          const shortSummary=String(item.description||'').trim().split(/\s+/).slice(0,25).join(' ');
          const headline=item.headline.replace(/[.!?]+$/u,'');
          return {target:publisher+': '+headline+'.'+(shortSummary?' '+shortSummary.replace(/[.!?]+$/u,'')+'.':''),english:''};
        });
        const linked=digestItems.slice(0,5).map(item=>({
          name:item.source||item.feed||'RSS',url:item.link
        }));
        stories.unshift({
          id:language+'-rss-briefing-'+getDay(),kind:'rss',
          language,title:titles[language],source:'Public RSS briefing',
          url:linked[0].url,sources:linked,
          publishedAt:digestItems[0].publishedAt||new Date().toISOString(),
          sentences:[{target:intro[language],english:''},...excerpts],
          words:[]
        });
        stories.length=3;
      }
      const data={language,updatedAt:new Date().toISOString(),stories,
        format:'public-rss-short',partial:stories.length<3};
      inMemoryNews.set(language,{fetchedAt:now,data});
      res.json(data);
    }catch(error){
      console.warn('Public RSS news refresh failed:',error?.message||error);
      if(cached?.data?.stories?.length)
        return res.json({...cached.data,stale:true,partial:true});
      res.status(503).json({
        error:'Public news feeds are currently unreachable. Please try Update again.'
      });
    }
  });
}
