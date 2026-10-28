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
        'Definition: a helpful, simple, one-sentence explanation IN THE TARGET LANGUAGE, WITHOUT writing the answer word, 7-16 words.',
        'Sentence: a NATURAL sentence in the target language, 7-10 words total, with the EXACT answer replaced by literal ____ (one blank).',
        'The missing word must fit grammatically as-is, including when the word is a multiword expression.',
        'wrong: ONE unrelated but plausible different word IN THE TARGET LANGUAGE, never the correct word.',
        'Return one card for each input word; preserve exact input id, word.',
        'No English in definitions or sample sentences unless the target language is English.',
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
  app.get('/study-news',async(req,res)=>{
    res.setHeader('Cache-Control','no-store');
    const language=LANGUAGE[req.query?.language]?req.query.language:'nl';
    const key=language+':'+getDay();
    if(inMemoryNews.has(key))return res.json(inMemoryNews.get(key));
    if(!process.env.OPENAI_API_KEY)return res.status(503).json({error:'OpenAI API key not configured.'});
    const cfg=LANGUAGE[language];
    try{
      const newsFeed='https://news.google.com/rss?hl='+encodeURIComponent(cfg.locale)+'&gl='+cfg.region+'&ceid='+encodeURIComponent(cfg.edition);
      const rss=await fetch(newsFeed,{headers:{'User-Agent':'ECL-Language-Learning/1.0'},signal:AbortSignal.timeout(16000)});
      if(!rss.ok)throw new Error('News feed HTTP '+rss.status);
      const articles=findFeeds(await rss.text());
      const seen=new Set();
      const titles=articles.filter(a=>{
        const k=a.headline.toLowerCase().slice(0,70);
        if(seen.has(k))return false;seen.add(k);return true;
      }).slice(0,3);
      if(titles.length<3)throw new Error('Not enough fresh headlines available');
      const system=[
        'You are producing ORIGINAL, concise language-learning news summaries in '+cfg.name+'.',
        'The ONLY factual source for each item is the supplied headline, publisher, description and date.',
        'Never invent facts, names, amounts, quotations, prices, dates or developments absent from the supplied facts.',
        'If the headline gives few facts, explain its general context neutrally and explicitly mark uncertainty.',
        'Never copy or paraphrase the whole source article. Write independent, educational summaries, NOT a reproduction.',
        'Create exactly 3 stories in the input order, each with 8 to 11 SHORT sentences (approximately 110–170 words target language total).',
        'Each story: original title in target language, "sentences" an array of {"target":"...","english":"..."} per sentence.',
        'The english text must be a natural, faithful English translation of the corresponding target sentence.',
        'Each story: exactly 10 useful vocabulary entries, {"word":"...","english":"...","definition":"...","example":"..."}.',
        'definition and example must be in the target language. Example: one practical sentence, no more than 12 words.',
        'Choose genuinely useful terms that actually appear in the target sentences. Avoid names.',
        'Use simple practical language, CEFR A2/B1, direct style. Teach through accessible prose.',
        'Do not claim there is up-to-the-minute reporting beyond the supplied feed.',
        'Return JSON {"stories":[{"title":"...","sentences":[{"target":"...","english":"..."}],"words":[{"word":"...","english":"...","definition":"...","example":"..."}]}]}.'
      ].join(' ');
      const generated=await jsonFromOpenAI(process.env.OPENAI_API_KEY,system,JSON.stringify({
        language,day:getDay(),headlines:titles
      }),6700);
      const stories=(Array.isArray(generated.stories)?generated.stories:[]).slice(0,3).map((o,i)=>{
        const source=titles[i];if(!source)return null;
        const sentences=(Array.isArray(o.sentences)?o.sentences:[]).slice(0,14)
          .map(x=>({target:safeText(x?.target,360),english:safeText(x?.english,360)}))
          .filter(x=>x.target&&x.english);
        const words=(Array.isArray(o.words)?o.words:[]).slice(0,10)
          .map(x=>({word:safeText(x?.word,65),english:safeText(x?.english,110),definition:safeText(x?.definition,240),example:safeText(x?.example,240)}))
          .filter(w=>isValidWord(w.word)&&w.english&&w.definition&&w.example);
        if(sentences.length<5||words.length<5)return null;
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
