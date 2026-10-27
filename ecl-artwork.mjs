import sharp from 'sharp';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import path from 'node:path';

const ROOT = process.cwd();
const NAMES = ['emma', 'charlotte', 'louis'];
const PHOTO_DIR = path.join(ROOT, 'ecl-avatar-image');
const sizes = [
  ['icon-192.png', 192],
  ['icon-512.png', 512],
  ['apple-touch-icon.png', 180],
  ['favicon-64.png', 64]
];

function nameOf(key) { return key[0].toUpperCase() + key.slice(1); }

function fallbackSilhouette(key) {
  const colors = {emma: ['#3d3330','#b6a99c'],charlotte:['#38312e','#a09384'],louis:['#373733','#9d9d95']};
  const [dark,light] = colors[key] || colors.louis;
  const label = nameOf(key);
  return Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="512" height="768" viewBox="0 0 512 768">
    <rect width="512" height="768" fill="${dark}"/>
    <circle cx="256" cy="292" r="116" fill="${light}" opacity=".80"/>
    <path d="M52 736v-96c0-152 90-224 204-224s204 72 204 224v96" fill="${light}" opacity=".80"/>
    <text x="256" y="714" font-family="sans-serif" font-size="43" text-anchor="middle" fill="#fff9ee">${label}</text>
  </svg>`);
}

async function basePhotos() {
  const original = Buffer.from((await readFile(path.join(ROOT,'emma-portrait.b64'),'utf8')).trim(),'base64');
  if(original[0]!==255 || original[1]!==216) throw new Error('Emma JPEG asset invalid');
  return {emma:original,charlotte:fallbackSilhouette('charlotte'),louis:fallbackSilhouette('louis')};
}

function portraitArtwork(key,buf) {
  return sharp(buf).rotate().resize(540,810,{fit:'cover',position:'centre'}).jpeg({quality:83}).toBuffer();
}

async function composeIcon(photoMap, size) {
  // 512px composition keeps three photographic portraits visible even at
  // 192px. ECL name stays in a contrasting footer like a native app mark.
  const width = 512;
  const panelWidth=146, panelHeight=336, panelY=47;
  const panelXs=[27,183,339];
  const images=await Promise.all(NAMES.map((key,i)=>
    sharp(photoMap[key]).rotate().resize(panelWidth,panelHeight,{fit:'cover',position:'centre'})
      .png().toBuffer().then(input=>({input,left:panelXs[i],top:panelY}))
  ));
  const background=Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="512" height="512">
    <rect width="512" height="512" rx="96" fill="#1e1e1c"/>
    <rect x="15" y="17" width="482" height="477" rx="65" fill="#292723"/>
    <text x="256" y="459" text-anchor="middle" font-family="Arial, Helvetica, sans-serif"
      font-size="67" font-weight="700" letter-spacing="13" fill="#f8f2e8">ECL</text>
  </svg>`);
  const composed=await sharp(background).composite(images).png().toBuffer();
  return sharp(composed).resize(size,size).png().toBuffer();
}

export async function writeEclArtwork(overrides={}) {
  await mkdir(PHOTO_DIR,{recursive:true});
  const photos={...(await basePhotos()),...overrides};
  // Keep existing Emma reference photo as the offline/placeholder image.
  await Promise.all(NAMES.map(async(key)=>{
    const jpg=await portraitArtwork(key,photos[key]);
    await writeFile(path.join(PHOTO_DIR,key+'.jpg'),jpg);
  }));
  await Promise.all(sizes.map(async([name,size])=>{
    await writeFile(path.join(ROOT,name),await composeIcon(photos,size));
  }));
  return Object.keys(overrides);
}

function photoUrlCandidates(obj) {
  if (!obj || typeof obj!=='object') return [];
  const d=obj.data || obj.persona || obj.avatar || obj;
  const props=['imageUrl','imageURL','image_url','thumbnailUrl','thumbnail_url',
    'previewImageUrl','preview_image_url','avatarImageUrl','avatar_image_url',
    'photoUrl','photo_url','portraitUrl','portrait_url','sourceImageUrl','source_image_url','image','thumbnail','previewImage'];
  const urls=[];
  for (const node of [obj,d,d.avatar,d.assets,d.media,d.preview,d.metadata]) {
    if(!node || typeof node!=='object') continue;
    for (const k of props) if(typeof node[k]==='string') urls.push(node[k]);
  }
  return urls;
}

function acceptMediaHost(url) {
  try {
    const u=new URL(url);
    if(u.protocol!=='https:' || u.username || u.password) return false;
    const host=u.hostname.toLowerCase();
    return ['anam.ai','anamai.io','amazonaws.com','cloudfront.net',
      'googleapis.com','cloudinary.com','imagekit.io','framerusercontent.com']
      .some(d=>host===d||host.endsWith('.'+d));
  } catch { return false; }
}

async function fetchPhotoFromUrl(url) {
  if(!acceptMediaHost(url)) return null;
  const response=await fetch(url,{signal:AbortSignal.timeout(5000)});
  if(!response.ok || +(response.headers.get('content-length')||0)>6_000_000)return null;
  const buf=Buffer.from(await response.arrayBuffer());
  if(buf.length>6_000_000)return null;
  const metadata=await sharp(buf).metadata();
  if(!metadata.width || metadata.width<100 || !metadata.height) return null;
  return buf;
}

async function anamRecord(apiKey,route) {
  const response=await fetch('https://api.anam.ai/v1/'+route,{
    headers:{Authorization:'Bearer '+apiKey},
    signal:AbortSignal.timeout(5500),cache:'no-store'
  });
  if(!response.ok) throw new Error('Anam media endpoint '+route+': '+response.status);
  return response.json();
}

async function findAnamPhoto(apiKey,personaId) {
  const record=await anamRecord(apiKey,'personas/'+encodeURIComponent(personaId));
  const d=record?.data || record?.persona || record;
  const avatarId=d?.avatarId || d?.avatar_id || d?.avatar?.id;
  let avatar=null;
  if(avatarId) {
    try { avatar=await anamRecord(apiKey,'avatars/'+encodeURIComponent(avatarId)); }
    catch(error) { console.warn('Avatar preview metadata not available:',error.message); }
  }
  const candidates=[...photoUrlCandidates(record),...photoUrlCandidates(avatar)];
  for(const url of candidates) {
    try {const buf=await fetchPhotoFromUrl(url);if(buf)return buf;}
    catch(error){console.warn('Avatar preview URL failed:',error.message);}
  }
  return null;
}

// Image retrieval is optional. When Anam makes actual preview pictures
// available, all three profile crops and home-screen icons replace fallbacks
// automatically. Never display a fictional portrait as the real avatar.
export async function refreshAnamEclArtwork(apiKey,personas) {
  if(!apiKey)return [];
  const pairs=await Promise.all(NAMES.map(async key=>{
    try {
      const photo=await findAnamPhoto(apiKey,personas[key].personaId);
      return [key,photo];
    } catch(error) {
      console.warn('ECL '+key+' avatar photo could not be retrieved:',error.message);
      return [key,null];
    }
  }));
  const available=Object.fromEntries(pairs.filter(([,photo])=>photo));
  if(Object.keys(available).length)await writeEclArtwork(available);
  return Object.keys(available);
}
