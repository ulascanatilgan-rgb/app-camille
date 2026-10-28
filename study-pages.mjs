// ECL's three-page learning experience. No Anam/Realtime audio session is
// required in Slide or News; browser speech reads these study materials.
export function initStudyPages({getLanguage,getTalkWords,stopTalk}) {
  const $=id=>document.getElementById(id);
  const tabs=[...document.querySelectorAll('.study-nav-button')];
  const pages={talk:$('talkPage'),slide:$('slidePage'),news:$('newsPage')};
  const locale={fr:'fr-FR',nl:'nl-BE',en:'en-GB'};
  let currentPage='talk', cards=[], cardIndex=0, deckLang='', pendingDeck=false;
  let newsData=null,newsLang='',newsReaderIndex=-1,newsPlaying=false,newsPaused=false;
  let speechIndex=0,speechSeq=0,wordHighlight=-1;
  let newsHighlightTimer=null;
  let lastUpdateCacheKey='';
  const info=(id,msg)=>{const e=$(id);if(e)e.textContent=msg};
  const store=(key,obj)=>{try{localStorage.setItem(key,JSON.stringify(obj))}catch{}};
  const read=(key,fallback)=>{try{return JSON.parse(localStorage.getItem(key)||'null')??fallback}catch{return fallback}};
  const key=(group,lang=getLanguage())=>'ecl.'+group+'.v1.'+lang;
  const validWords=()=>getTalkWords().filter(w=>w?.nl&&w?.en&&(!w.language||w.language===getLanguage())).slice(-800);
  const score=()=>read(key('slide.results'),[]);
  const newsWords=()=>read(key('news.words'),[]);
  const safeDate=()=>new Date().toISOString().slice(0,10);
  const say=(text)=>{
    if(!('speechSynthesis' in window))return;
    window.speechSynthesis.cancel();
    const u=new SpeechSynthesisUtterance(String(text).slice(0,330));
    u.lang=locale[getLanguage()]||'nl-BE';u.rate=.88;
    window.speechSynthesis.speak(u);
  };
  function stopNews() {
    newsPlaying=false;newsPaused=false;speechSeq++;
    if(newsHighlightTimer){clearInterval(newsHighlightTimer);newsHighlightTimer=null;}
    window.speechSynthesis?.cancel?.();
    const btn=$('newsRunButton');if(btn)btn.textContent='▶ Run';
  }
  function updateCounts() {
    const r=score();
    info('slideTotal',String(r.length));
    info('slideCorrect',String(r.filter(x=>x.correct).length));
    info('slideWrong',String(r.filter(x=>!x.correct).length));
  }
  function changePage(next) {
    if(!pages[next]||next===currentPage)return;
    const wasTalk=currentPage==='talk';
    if(currentPage==='news')stopNews();
    currentPage=next;
    document.body.dataset.eclPage=next;
    for(const [name,node] of Object.entries(pages))node.hidden=name!==next;
    document.querySelector('.topic-strip').hidden=next!=='talk';
    document.querySelector('.conversation-provider-strip').hidden=next!=='talk';
    for(const btn of tabs){
      const selected=btn.dataset.page===next;
      btn.classList.toggle('selected',selected);
      if(selected)btn.setAttribute('aria-current','page');else btn.removeAttribute('aria-current');
    }
    // Leaving Talk intentionally ends paid Anam/OpenAI sessions.
    if(wasTalk && next!=='talk')Promise.resolve(stopTalk()).catch(err=>console.warn('Talk did not fully stop:',err));
    if(next==='slide')void loadSlide();
    if(next==='news')renderNews();
  }
  for(const tab of tabs)tab.addEventListener('click',()=>changePage(tab.dataset.page));

  const shuffled=items=>[...items].sort(()=>Math.random()-.5);
  function setSlideEmpty(message) {
    const card=$('slideCard');card.hidden=true;
    $('slideLeftButton').disabled=true;$('slideRightButton').disabled=true;
    info('slideStatus',message);
  }
  function renderSlide() {
    updateCounts();
    const item=cards[cardIndex%cards.length];
    if(!item){setSlideEmpty('No cards yet. Open Talk to learn words, then return to Slide.');return}
    $('slideCard').hidden=false;
    $('slideLeftButton').disabled=false;$('slideRightButton').disabled=false;
    info('slideStatus',(cardIndex+1)+' / '+cards.length+' · Swipe the card or tap an arrow');
    info('slideDefinition',item.definition);
    const sentence=$('slideSentence');sentence.replaceChildren();
    const fragments=item.sentence.split('____');
    const before=document.createTextNode(fragments[0]||'');
    const gap=document.createElement('span');gap.className='slide-masked-word';
    gap.textContent=item.word;gap.setAttribute('aria-label','Hidden answer');
    gap.setAttribute('title','Find the missing word');
    sentence.append(before,gap,document.createTextNode(fragments[1]||''));
    info('slideLeftWord', '');info('slideRightWord','');
    for(const [id,answer,side] of [
      ['slideLeftWord',item.correctSide==='left'?item.word:item.wrong,'LEFT'],
      ['slideRightWord',item.correctSide==='right'?item.word:item.wrong,'RIGHT']
    ]) {
      const label=$(id);
      const meta=document.createElement('span');meta.textContent=side==='LEFT'?'← LEFT':'RIGHT →';
      const strong=document.createElement('strong');strong.textContent=answer;
      label.append(meta,strong);
    }
    const c=$('slideCard');
    c.classList.remove('swipe-left','swipe-right','fly-left','fly-right','dragging','snap-back');
    c.style.transform='';slideLocked=false;
  }
  function answerSlide(side) {
    const item=cards[cardIndex%cards.length];
    if(!item||pendingDeck||slideLocked)return;
    slideLocked=true;
    const correct=side===item.correctSide;
    const results=score();results.push({
      id:item.id,word:item.word,meaning:item.meaning,correct,chosen:side,
      at:new Date().toISOString()
    });store(key('slide.results'),results.slice(-1000));
    info('slideFeedback',(correct?'Correct! ':'Wrong — ')+item.word+' · '+item.meaning);
    const card=$('slideCard');
    card.classList.remove('dragging','snap-back');
    card.style.transform='';
    card.classList.add(side==='left'?'fly-left':'fly-right');
    const langAtSwipe=getLanguage();
    const previousDeck=cards;
    window.setTimeout(()=>{
      if(cards!==previousDeck)return;
      cardIndex++;
      if(currentPage==='slide'&&deckLang===langAtSwipe)renderSlide();
      else slideLocked=false;
    },310);
    updateCounts();
  }
  $('slideLeftButton').addEventListener('click',()=>answerSlide('left'));
  $('slideRightButton').addEventListener('click',()=>answerSlide('right'));
  // Genuine Tinder-style gesture: the card follows the pointer while held.
  // Keep vertical scrolling available until horizontal movement is intentional.
  let gesture=null,slideLocked=false;
  const slide=$('slideCard');
  function resetSwipe(){
    gesture=null;
    slide.classList.remove('dragging');
    slide.classList.add('snap-back');
    slide.style.transform='';
    slide.querySelectorAll('.slide-choice').forEach(e=>e.classList.remove('direction-active'));
    window.setTimeout(()=>slide.classList.remove('snap-back'),220);
  }
  slide.addEventListener('pointerdown',ev=>{
    if(slideLocked || pendingDeck || ev.button>0 || !cards.length)return;
    gesture={id:ev.pointerId,x:ev.clientX,y:ev.clientY,dx:0,dy:0,tracking:false};
  });
  slide.addEventListener('pointermove',ev=>{
    if(!gesture || ev.pointerId!==gesture.id || slideLocked)return;
    const dx=ev.clientX-gesture.x,dy=ev.clientY-gesture.y;
    gesture.dx=dx;gesture.dy=dy;
    if(!gesture.tracking){
      if(Math.abs(dy)>Math.abs(dx) && Math.abs(dy)>12){gesture=null;return;}
      if(Math.abs(dx)<9 || Math.abs(dx)<=Math.abs(dy)*1.1)return;
      gesture.tracking=true;
      try{slide.setPointerCapture(ev.pointerId)}catch{}
      slide.classList.remove('snap-back');slide.classList.add('dragging');
    }
    slide.style.transform='translateX('+dx+'px) rotate('+(dx/20)+'deg)';
    const active=dx<-35?'left':dx>35?'right':'';
    $('slideLeftWord').classList.toggle('direction-active',active==='left');
    $('slideRightWord').classList.toggle('direction-active',active==='right');
    if(ev.cancelable)ev.preventDefault();
  });
  slide.addEventListener('pointerup',ev=>{
    if(!gesture || ev.pointerId!==gesture.id)return;
    const {dx,dy,tracking}=gesture;
    gesture=null;
    if(tracking && Math.abs(dx)>=Math.max(70,slide.clientWidth*.19) &&
      Math.abs(dx)>Math.abs(dy)*1.2)answerSlide(dx<0?'left':'right');
    else resetSwipe();
  });
  slide.addEventListener('pointercancel',resetSwipe);
  slide.addEventListener('lostpointercapture',()=>{
    if(gesture && gesture.tracking)resetSwipe();
  });
  slide.addEventListener('keydown',ev=>{
    if(ev.key==='ArrowLeft'||ev.key==='ArrowRight'){
      ev.preventDefault();answerSlide(ev.key==='ArrowLeft'?'left':'right');
    }
  });
  function makeDeck(raw,lang) {
    return shuffled(raw).map((c,i)=>({...c,correctSide:Math.random()<.5?'left':'right'}));
  }
  async function loadSlide(force=false) {
    if(pendingDeck)return;
    const lang=getLanguage();deckLang=lang;
    updateCounts();
    const words=validWords();
    if(!words.length){cards=[];setSlideEmpty('No Talk words yet. Practice a conversation to collect new vocabulary.');return}
    const signature=words.map(w=>w.id||w.nl).join('|');
    const cached=read(key('slide.deck',lang),{});
    if(!force&&cached.signature===signature&&Array.isArray(cached.cards)&&cached.cards.length){
      cards=makeDeck(cached.cards,lang);cardIndex=0;renderSlide();return;
    }
    pendingDeck=true;setSlideEmpty('Preparing practice cards from your Talk words…');
    try {
      const input=shuffled(words).slice(0,24).map(w=>({id:String(w.id||w.nl),word:String(w.nl),meaning:String(w.en)}));
      const resp=await fetch('/study-slide-deck',{
        method:'POST',headers:{'Content-Type':'application/json'},
        body:JSON.stringify({language:lang,words:input})
      });
      const result=await resp.json();
      if(!resp.ok)throw new Error(result.error||'Card generation unavailable');
      if(getLanguage()!==lang)return;
      const accepted=Array.isArray(result.cards)?result.cards.filter(c=>c?.word&&c?.sentence?.includes('____')&&c?.wrong&&c?.definition):[];
      if(!accepted.length)throw new Error('No valid cards returned. Please try again.');
      store(key('slide.deck',lang),{signature,cards:accepted});
      cards=makeDeck(accepted,lang);cardIndex=0;
      info('slideFeedback','');renderSlide();
    }catch(error){if(getLanguage()===lang)setSlideEmpty(String(error.message||'Card generator unavailable'))}
    finally{pendingDeck=false;}
  }
  $('slideReloadButton').addEventListener('click',()=>void loadSlide(true));

  // Word libraries are independent: Slide uses Talk words, News has its own.
  async function slideWordDetails(item) {
    const lang=getLanguage(),id=String(item.id||item.nl);
    const all=read(key('slide.deck',lang),{}).cards||[];
    const extra=read(key('slide.details',lang),{});
    const existing=all.find(w=>String(w.id)===id) || extra[id];
    if(existing)return existing;
    const response=await fetch('/study-slide-deck',{
      method:'POST',headers:{'Content-Type':'application/json'},
      body:JSON.stringify({language:lang,words:[{id,word:item.nl,meaning:item.en}]})
    });
    const data=await response.json();
    if(!response.ok||!data.cards?.[0])throw new Error(data.error||'Explanation unavailable');
    if(lang===getLanguage()){
      extra[id]=data.cards[0];store(key('slide.details',lang),extra);
    }
    return data.cards[0];
  }
  function createPlay(label,text) {
    const play=document.createElement('button');play.type='button';play.className='study-word-audio';
    play.textContent='🎧';play.title=label;play.setAttribute('aria-label',label);
    play.addEventListener('click',ev=>{ev.stopPropagation();say(text)});
    return play;
  }
  function openWordLibrary(which) {
    stopNews();
    const dialog=$('studyWordsDialog'),lang=getLanguage(),isSlide=which==='slide';
    info('studyWordsTitle',isSlide?'Slide Words':'News Words');
    info('studyWordsEyebrow',(isSlide?'TALK WORDS':'NEWS VOCABULARY')+' · '+lang.toUpperCase());
    const filters=$('studyWordsFilters');filters.replaceChildren();
    const options=isSlide?['All Words','Wrong Words','Correct Words']:['All Words'];
    const records=isSlide?validWords():newsWords(),results=score(),list=$('studyWordsList');
    let filterRun=0;
    function renderFilter(filter) {
      filterRun++;
      const run=filterRun;
      [...filters.children].forEach(e=>e.classList.toggle('active',e.textContent===filter));
      list.replaceChildren();
      let selected=records;
      if(isSlide && filter!=='All Words'){
        const good=filter==='Correct Words';
        const ids=new Set(results.filter(r=>r.correct===good).map(r=>r.id));
        selected=records.filter(w=>ids.has(w.id||w.nl));
      }
      if(!selected.length){
        const p=document.createElement('p');p.className='study-empty';
        p.textContent='No words in this category yet.';list.append(p);return;
      }
      for(const item of [...selected].reverse()) {
        const word=isSlide?item.nl:item.word;
        const row=document.createElement('div');row.className='study-word-row';
        const main=document.createElement('div');main.className='study-word-row-main';
        const heading=document.createElement('div');heading.className='study-word-row-heading';
        const expand=document.createElement('button');expand.type='button';
        expand.className='study-word-expand';expand.textContent=word+' · '+(isSlide?item.en:item.english);
        expand.setAttribute('aria-expanded','false');
        heading.append(expand);
        main.append(heading);
        const detail=document.createElement('div');detail.className='study-word-expanded';detail.hidden=true;
        main.append(detail);
        let loaded=false;
        const setDetail=(def,example)=>{
          detail.replaceChildren();
          const explanation=document.createElement('p');explanation.className='study-word-detail';
          explanation.textContent=def;
          const usage=document.createElement('p');usage.className='study-word-example';
          usage.textContent=example;
          const actions=document.createElement('div');actions.className='study-word-actions';
          actions.append(createPlay('Hear '+word,word),createPlay('Hear example sentence',example));
          detail.append(explanation,usage,actions);
        };
        expand.addEventListener('click',async()=>{
          const open=detail.hidden;
          detail.hidden=!open;expand.setAttribute('aria-expanded',String(open));
          if(!open||loaded)return;
          if(!isSlide){
            setDetail(item.definition,item.example);loaded=true;return;
          }
          detail.textContent='Preparing explanation and example…';
          try {
            const found=await slideWordDetails(item);
            if(run!==filterRun||lang!==getLanguage())return;
            const complete=found.sentence.replace('____',found.word);
            setDetail(found.definition,complete);loaded=true;
          }catch(err){
            detail.textContent='Could not prepare this example. Tap the word to retry.';
          }
        });
        const play=createPlay('Hear '+word,word);
        row.append(main,play);list.append(row);
      }
    }
    for(const option of options) {
      const button=document.createElement('button');button.type='button';button.textContent=option;
      button.addEventListener('click',()=>renderFilter(option));filters.append(button);
    }
    renderFilter('All Words');dialog.showModal();
  }
  $('slideWordsButton').addEventListener('click',()=>openWordLibrary('slide'));
  $('newsWordsButton').addEventListener('click',()=>openWordLibrary('news'));
  $('studyWordsClose').addEventListener('click',()=>$('studyWordsDialog').close());
  $('studyWordsDialog').addEventListener('click',e=>{if(e.target===$('studyWordsDialog'))e.target.close()});

  function addNewsWords(article) {
    const existing=newsWords();
    const known=new Set(existing.map(x=>x.word.toLowerCase()));
    for(const w of article.words) {
      if(known.has(w.word.toLowerCase()))continue;
      existing.push({...w,articleId:article.id,at:new Date().toISOString()});
      known.add(w.word.toLowerCase());
    }
    store(key('news.words'),existing.slice(-800));
  }
  function renderNews() {
    const lang=getLanguage(),today=safeDate();
    if(newsLang!==lang){
      stopNews();newsLang=lang;newsReaderIndex=-1;
      const saved=read(key('news.daily',lang),null);
      newsData=saved?.updatedAt?.slice(0,10)===today?saved:null;
    }
    const stories=$('newsStoryList');
    stories.replaceChildren();
    if(!newsData?.stories?.length){
      $('newsReader').hidden=true;
      info('newsStatus','Tap Update to load today\'s three articles in '+({nl:'Dutch',fr:'French',en:'English'}[lang])+'.');
      return;
    }
    info('newsStatus','Updated '+new Date(newsData.updatedAt).toLocaleDateString()+'. Three original learning summaries based on current headlines.');
    if(newsReaderIndex>=0&&newsReaderIndex<newsData.stories.length){renderNewsReader();return;}
    $('newsReader').hidden=true;stories.hidden=false;
    newsData.stories.forEach((story,index)=>{
      const btn=document.createElement('button');btn.type='button';btn.className='news-story-card';
      const meta=document.createElement('span');meta.className='news-card-meta';
      meta.textContent=(index+1)+' / 3 · '+story.source+(story.publishedAt?' · '+new Date(story.publishedAt).toLocaleDateString():'');
      const h=document.createElement('strong');h.textContent=story.title;
      const sub=document.createElement('span');sub.textContent='Read & listen · '+story.sentences.length+' short sentences';
      btn.append(meta,h,sub);
      btn.addEventListener('click',()=>{newsReaderIndex=index;renderNewsReader();});
      stories.append(btn);
    });
  }
  async function updateNews() {
    const lang=getLanguage(),today=safeDate();
    const cached=read(key('news.daily',lang),null);
    // One dated update per language per day. Reopening uses saved content.
    if(cached?.updatedAt?.startsWith(today)){
      newsData=cached;newsLang=lang;newsReaderIndex=-1;renderNews();return;
    }
    $('newsUpdateButton').disabled=true;info('newsStatus','Loading headlines and building accessible reading articles…');
    try{
      const resp=await fetch('/study-news?language='+encodeURIComponent(lang),{cache:'no-store'});
      const data=await resp.json();
      if(!resp.ok)throw new Error(data?.error||'News unavailable');
      if(!Array.isArray(data.stories)||data.stories.length!==3)throw new Error('Incomplete news update');
      store(key('news.daily',lang),data);
      if(lang===getLanguage()){newsData=data;newsLang=lang;newsReaderIndex=-1;renderNews();}
    }catch(error){info('newsStatus',String(error.message||'News update could not finish'))}
    finally{$('newsUpdateButton').disabled=false;}
  }
  $('newsUpdateButton').addEventListener('click',()=>void updateNews());
  $('newsBackButton').addEventListener('click',()=>{
    stopNews();newsReaderIndex=-1;renderNews();
  });
  function renderNewsReader() {
    const article=newsData?.stories?.[newsReaderIndex];if(!article)return;
    $('newsStoryList').hidden=true;
    const reader=$('newsReader');reader.hidden=false;
    info('newsReaderTitle',article.title);
    const source=$('newsReaderSource');source.replaceChildren();
    const name=document.createElement('span');
    name.textContent='Based on: '+article.source+(article.publishedAt?' · '+new Date(article.publishedAt).toLocaleDateString():'')+' · ';
    const link=document.createElement('a');
    link.textContent='Original source';link.href=article.url;link.target='_blank';link.rel='noopener noreferrer';
    source.append(name,link);
    addNewsWords(article);
    const vocab=$('newsReaderWords');vocab.replaceChildren();
    for(const w of article.words){
      const btn=document.createElement('button');btn.type='button';btn.className='news-vocab-item';
      const first=document.createElement('strong');first.textContent=w.word;
      const en=document.createElement('span');en.textContent=w.english;
      btn.append(first,en);btn.title=w.definition+' · '+w.example;
      btn.addEventListener('click',()=>say(w.word));
      vocab.append(btn);
    }
    speechIndex=0;renderArticleText(article);
    info('newsReadEnglish',article.sentences[0]?.english||'');
    $('newsRunButton').textContent='▶ Run';
  }
  function renderArticleText(article) {
    const target=$('newsReadTarget');target.replaceChildren();
    article.sentences.forEach((s,i)=>{
      const line=document.createElement('p');line.className='news-sentence';
      line.dataset.sentence=String(i);
      if(i===speechIndex)line.classList.add('active-sentence');
      // Tokenization by whitespace preserves punctuation and word offsets.
      const tokens=s.target.split(/(\s+)/);
      let pos=0;
      for(const token of tokens){
        if(!token)continue;
        if(/^\s+$/.test(token)){line.append(document.createTextNode(token));pos+=token.length;continue;}
        const span=document.createElement('span');span.className='news-token';
        span.textContent=token;span.dataset.charStart=String(pos);
        if(i===speechIndex && pos<=wordHighlight &&
           wordHighlight<pos+token.length)span.classList.add('speaking');
        line.append(span);pos+=token.length;
      }
      target.append(line);
    });
    target.querySelector('.active-sentence')?.scrollIntoView({block:'nearest',behavior:'smooth'});
  }
  function setSpeechIndex(i,word=-1) {
    const story=newsData?.stories?.[newsReaderIndex];if(!story)return;
    speechIndex=i;wordHighlight=word;
    const lines=[...$('newsReadTarget').querySelectorAll('.news-sentence')];
    lines.forEach((line,n)=>{
      line.classList.toggle('active-sentence',n===i);
      for(const token of line.querySelectorAll('.news-token')) {
        const pos=Number(token.dataset.charStart);
        token.classList.toggle('speaking',n===i&&word>=pos&&word<pos+token.textContent.length);
      }
    });
    info('newsReadEnglish',story.sentences[i]?.english||'');
    lines[i]?.scrollIntoView({block:'nearest',behavior:'smooth'});
  }
  function speakCurrent(seq) {
    if(seq!==speechSeq||!newsPlaying||newsPaused)return;
    const story=newsData?.stories?.[newsReaderIndex];
    if(!story||speechIndex>=story.sentences.length){stopNews();return;}
    if(!window.speechSynthesis){info('newsStatus','Speech playback is not available in this browser.');stopNews();return;}
    const sentence=story.sentences[speechIndex].target;
    setSpeechIndex(speechIndex,-1);
    const u=new SpeechSynthesisUtterance(sentence);
    u.lang=locale[getLanguage()]||'nl-BE';u.rate=.84;
    if(newsHighlightTimer){clearInterval(newsHighlightTimer);newsHighlightTimer=null;}
    let sawWordBoundary=false;
    // Safari sometimes omits SpeechSynthesis word-boundary events.
    // Use a conservative timed fallback, and stop it once true boundaries
    // arrive, so learners always see some word-by-word progress.
    const words=[...sentence.matchAll(/\\S+/g)].map(x=>x.index);
    let estimatedWord=0;
    newsHighlightTimer=setInterval(()=>{
      if(seq!==speechSeq || !newsPlaying){clearInterval(newsHighlightTimer);newsHighlightTimer=null;return;}
      if(newsPaused||sawWordBoundary)return;
      if(estimatedWord<words.length)setSpeechIndex(speechIndex,words[estimatedWord++]);
    },460);
    u.onboundary=e=>{
      if(seq!==speechSeq)return;
      sawWordBoundary=true;
      if(e.name==='word'||typeof e.charIndex==='number')setSpeechIndex(speechIndex,e.charIndex);
    };
    u.onend=()=>{
      if(newsHighlightTimer){clearInterval(newsHighlightTimer);newsHighlightTimer=null;}
      if(seq!==speechSeq||!newsPlaying||newsPaused)return;
      speechIndex+=1;
      if(speechIndex<story.sentences.length)speakCurrent(seq);else stopNews();
    };
    u.onerror=()=>{
      if(newsHighlightTimer){clearInterval(newsHighlightTimer);newsHighlightTimer=null;}
      if(seq===speechSeq){info('newsStatus','Audio interrupted. Tap Run to resume.');stopNews()}
    };
    window.speechSynthesis.speak(u);
  }
  $('newsRunButton').addEventListener('click',()=>{
    const story=newsData?.stories?.[newsReaderIndex];if(!story)return;
    if(newsPlaying&&!newsPaused){stopNews();return}
    if(speechIndex>=story.sentences.length)speechIndex=0;
    newsPlaying=true;newsPaused=false;speechSeq++;
    window.speechSynthesis.cancel();
    $('newsRunButton').textContent='■ Stop';
    speakCurrent(speechSeq);
  });
  $('newsPauseButton').addEventListener('click',()=>{
    if(!newsPlaying)return;
    newsPaused=!newsPaused;
    if(newsPaused)window.speechSynthesis.pause();
    else window.speechSynthesis.resume();
    $('newsPauseButton').textContent=newsPaused?'Resume':'Pause';
  });
  function refreshLanguage(){
    stopNews();
    if(currentPage==='slide'){cards=[];cardIndex=0;void loadSlide();}
    if(currentPage==='news'){newsLang='';newsReaderIndex=-1;renderNews();}
  }
  return {refreshLanguage,stopNews,getPage:()=>currentPage};
}
