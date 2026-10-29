// ECL Slide + News study routes. The browser only receives original
// educational summaries and links to their cited news sources.
const LANGUAGE = {
  fr:{name:'French',locale:'fr-FR',region:'FR',edition:'FR:fr'},
  nl:{name:'Belgian Dutch/Flemish',locale:'nl-BE',region:'BE',edition:'BE:nl'},
  en:{name:'English',locale:'en-GB',region:'GB',edition:'GB:en'}
};
const inMemoryNews = new Map();
// The public sources sometimes double-encode HTML (&amp;nbsp;, &nbsp;,
// numeric references). Decode before stripping tags, never display markup.
function decodeEntities(value) {
  let result=String(value||'');
  const named={nbsp:' ',amp:'&',quot:'"',apos:"'",lt:'<',gt:'>',
    ndash:'–',mdash:'—',hellip:'…',lsquo:'‘',rsquo:'’',
    ldquo:'“',rdquo:'”',bull:'•',euro:'€',copy:'©'};
  for(let i=0;i<3;i++){
    const next=result.replace(/&(#x[0-9a-f]+|#[0-9]+|[a-z][a-z0-9]+);/gi,(match,name)=>{
      if(name.startsWith('#')){
        const hex=name[1]?.toLowerCase()==='x',n=parseInt(name.slice(hex?2:1),hex?16:10);
        return n>0&&n<=0x10ffff?String.fromCodePoint(n):' ';
      }
      return named[name.toLowerCase()]??' ';
    });
    if(next===result)break;
    result=next;
  }
  return result.replace(/[\u00a0\u200b-\u200d\ufeff]/g,' ').replace(/\uFFFD/g,'');
}
function safeText(value,max=350) {
  return decodeEntities(String(value||'').replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi,' ')
    .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi,' ')
    .replace(/<[^>]*>/g,' '))
    .replace(/\s+/g,' ').trim().slice(0,max);
}
function decodeXml(s) {return decodeEntities(String(s||'').replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g,'$1'));}
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
  const rss=[...xml.matchAll(/<item\b[^>]*>([\s\S]*?)<\/item>/gi)].map(([,body])=>{
    const headline=safeText(tag(body,'title'),240);
    const link=cleanArticleHref(decodeXml(tag(body,'link')).trim());
    const description=safeText(tag(body,'description')||tag(body,'content:encoded'),2100);
    const source=safeText(tag(body,'source'),95);
    const pubDate=tag(body,'pubDate')||tag(body,'dc:date');
    return {headline,link,description,source,
      publishedAt:Number.isFinite(Date.parse(pubDate))?new Date(pubDate).toISOString():null};
  });
  // The Conversation and some free-access magazines publish Atom instead.
  const atom=[...xml.matchAll(/<entry\b[^>]*>([\s\S]*?)<\/entry>/gi)].map(([,body])=>{
    const headline=safeText(tag(body,'title'),240);
    const linkMatch=body.match(/<link\b[^>]*\bhref=["']([^"']+)["'][^>]*\/?>/i);
    const link=cleanArticleHref(decodeXml(linkMatch?.[1]||''));
    const description=safeText(tag(body,'summary')||tag(body,'content'),2100);
    const pubDate=tag(body,'published')||tag(body,'updated');
    return {headline,link,description,source:'The Conversation',
      publishedAt:Number.isFinite(Date.parse(pubDate))?new Date(pubDate).toISOString():null};
  });
  return [...rss,...atom].filter(x=>x.headline&&x.link);
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
function getDay() {return new Date().toLocaleDateString('sv-SE',{timeZone:'Europe/Brussels'})}
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
        'englishSentence: a FULL clear English translation of the COMPLETED target-language sentence, including the missing answer UNHIDDEN. No underscores or blanks. Never omit this field.',
        'Return one card for each input word; preserve exact input id, word.',
        'The definition MUST be in English. The sample sentence and wrong option MUST be in the target language only.',
        'JSON ONLY {"cards":[{"id":"...","definition":"...","sentence":"... ____ ...","englishSentence":"English complete sentence","wrong":"..."}]}'
      ].join(' ');
      const result=await jsonFromOpenAI(process.env.OPENAI_API_KEY,system,JSON.stringify({language,words}),3600);
      const expected=new Map(words.map(w=>[w.id,w]));
      const cards=(Array.isArray(result.cards)?result.cards:[]).map(c=>{
        const w=expected.get(String(c?.id));
        if(!w)return null;
        const definition=safeText(c.definition,260),sentence=safeText(c.sentence,240),wrong=safeText(c.wrong,65),englishSentence=safeText(c.englishSentence,300);
        if(!definition||!englishSentence||englishSentence.includes('____')||!sentence.includes('____')||sentence.split('____').length!==2||
          !isValidWord(wrong)||wrong.toLowerCase()===w.word.toLowerCase() ||
          !/\p{Script=Latin}/u.test(definition))return null;
        if(definition.toLocaleLowerCase().includes(w.word.toLocaleLowerCase()))return null;
        const count=sentence.trim().split(/\s+/).length;
        if(count<6||count>11)return null;
        return {id:w.id,word:w.word,meaning:w.meaning,definition,sentence,wrong,englishSentence};
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
  // Three original long-form learning articles compiled from public RSS/Atom
  // and accessible source context. Never republish full copyrighted stories.
  app.get('/study-news',async(req,res)=>{
    res.setHeader('Cache-Control','no-store');
    const language=LANGUAGE[req.query?.language]?req.query.language:'nl';
    const saved=inMemoryNews.get(language),now=Date.now();
    if(req.query?.refresh!=='1'&&saved?.data?.stories?.length===3&&now-saved.fetchedAt<4*3600000)
      return res.json(saved.data);
    if(!process.env.OPENAI_API_KEY){
      if(saved?.data?.stories?.length)return res.json({...saved.data,stale:true});
      return res.status(503).json({error:'Article editing is unavailable: OPENAI_API_KEY is not configured.'});
    }
    const feeds=[
      'https://aeon.co/feed.rss',
      'https://www.smithsonianmag.com/rss/arts-culture/',
      'https://www.smithsonianmag.com/rss/history/',
      'https://www.smithsonianmag.com/rss/science-nature/',
      'https://theconversation.com/articles.atom?language=en',
      'https://theconversation.com/fr/articles.atom',
      'https://feeds.bbci.co.uk/news/world/rss.xml',
      'https://www.theguardian.com/culture/rss',
      'https://www.theguardian.com/business/rss',
      'https://feeds.nos.nl/nosnieuwsalgemeen',
      'https://www.france24.com/fr/rss'
    ];
    try{
      const results=await Promise.allSettled(feeds.map(async address=>{
        const response=await fetch(address,{
          headers:{'User-Agent':'Mozilla/5.0 (compatible; ECL-ArticleReader/1.0)',
            'Accept':'application/rss+xml,application/atom+xml,text/xml,application/xml,*/*'},
          signal:AbortSignal.timeout(9000)
        });
        if(!response.ok)throw new Error('Feed HTTP '+response.status);
        const items=findFeeds(await response.text());
        const host=new URL(address).hostname.replace(/^www\./,'');
        return items.slice(0,16).map(x=>({...x,source:x.source||host,feed:host}));
      }));
      const entries=results.filter(x=>x.status==='fulfilled').flatMap(x=>x.value)
        .filter(x=>x.headline&&x.link&&x.description.length>=45);
      const seen=new Set();
      const unique=entries.filter(item=>{
        const normalized=item.headline.toLocaleLowerCase().replace(/[^\p{L}\p{N}]+/gu,' ').slice(0,110);
        if(!normalized||seen.has(normalized))return false;
        seen.add(normalized);return true;
      }).sort((a,b)=>(Date.parse(b.publishedAt)||0)-(Date.parse(a.publishedAt)||0));
      if(!unique.length)throw new Error('All accessible article feeds returned no usable source material');
      const selected=[],sources=new Set();
      for(const item of unique){
        const domain=item.feed;
        if(sources.has(domain))continue;
        sources.add(domain);selected.push(item);
        if(selected.length===4)break;
      }
      for(const item of unique){
        if(selected.length>=4)break;
        if(!selected.includes(item))selected.push(item);
      }
      const candidates=selected.slice(0,4);
      // Review pages where available; summaries still work if a publisher blocks access.
      const contexts=await Promise.all(candidates.map(x=>sourceContext(x)));
      const generation=await Promise.allSettled(candidates.map(async(item,i)=>{
        const background=contexts[i]||'';
        const sourceMaterial={headline:item.headline,summary:item.description,
          source:item.source,publishedAt:item.publishedAt,
          articleContext:background.slice(0,3800),url:item.link};
        const system=[
          'You are a careful independent editor and experienced B1 language teacher.',
          'Write ONE completely ORIGINAL coherent magazine-style explanatory article in '+LANGUAGE[language].name+'.',
          'The output MUST contain at least 250 words and ideally 290–350 words, written as 20–28 linked full sentences in logical order.',
          'Build a connected introduction, factual explanation, background, implications and a natural conclusion.',
          'Stay focused on one specific source topic. No unrelated headlines, disjointed fragments, source attribution in every sentence, numbered lists or stock introductions.',
          'Use supplied public headline, summary and articleContext as factual evidence; do not invent quotations, event details, numbers, dates, findings or allegations.',
          'If evidence is limited, use modest general explanatory context instead of inventing facts. Attribute contested political claims fairly and neutrally.',
          'Do not copy sentences or substantial phrasing from any publisher. This is a transformed original learning article, not a pasted source.',
          'Use straightforward everyday vocabulary and natural linking phrases appropriate for B1.',
          'Return strict JSON: {"title":"short target-language headline","sentences":[{"target":"one complete target-language sentence"}],"words":[{"word":"target-language vocabulary from the article","english":"short English meaning","definition":"short target-language explanation","example":"short example in target language"}]}.',
          'Include 6–9 correct useful vocabulary items actually used in the article. No HTML, entities, markdown, symbols or English in target sentences.',
          'Ensure the article is 250 words MINIMUM. Check word count before answering.'
        ].join(' ');
        for(let attempt=0;attempt<2;attempt++){
          try{
            const data=await jsonFromOpenAI(process.env.OPENAI_API_KEY,system+
              (attempt?' The previous response was too short or malformed: write 300–360 full words, with complete sentences.':''),
              JSON.stringify(sourceMaterial),4400);
            const rows=(Array.isArray(data.sentences)?data.sentences:[])
              .map(row=>({target:safeText(typeof row==='string'?row:row?.target,430),english:''}))
              .filter(row=>row.target&&/[.!?。！？]$/.test(row.target));
            const count=rows.join(' ').split(/\s+/).filter(Boolean).length;
            if(count<250||rows.length<15)throw new Error('Only '+count+' words / '+rows.length+' sentences');
            const words=(Array.isArray(data.words)?data.words:[]).slice(0,10)
              .map(w=>({word:safeText(w.word,65),english:safeText(w.english,95),
                definition:safeText(w.definition,200),example:safeText(w.example,200)}))
              .filter(w=>isValidWord(w.word)&&w.english&&w.definition&&w.example);
            return {id:language+'-article-'+getDay()+'-'+i,
              kind:'article',language,title:safeText(data.title,175)||item.headline,
              sourceHeadline:item.headline,source:item.source,
              url:item.link,publishedAt:item.publishedAt,
              sentences:rows,words,wordCount:count};
          }catch(error){
            console.warn('Article '+i+' attempt '+(attempt+1)+':',error?.message||error);
            if(attempt===1)throw error;
          }
        }
      }));
      const stories=generation.filter(x=>x.status==='fulfilled').map(x=>x.value).slice(0,3);
      if(!stories.length)throw new Error('Could not produce a complete 250-word article from available sources');
      const data={language,updatedAt:new Date().toISOString(),stories,
        format:'original-magazine-articles-v1',partial:stories.length<3};
      inMemoryNews.set(language,{fetchedAt:now,data});
      res.json(data);
    }catch(error){
      console.warn('Article update failed:',error?.message||error);
      if(saved?.data?.stories?.length)return res.json({...saved.data,stale:true,partial:true});
      res.status(502).json({error:'No complete articles could be prepared. Check source/API availability and retry Update.'});
    }
  });
}
