const state={facilities:[],index:null,cellSizeDeg:.01,ref:null,map:null,layers:{}};

function toRad(x){return x*Math.PI/180}
function haversineMeters(a,b){
 const R=6371000;
 const dLat=toRad(b.lat-a.lat),dLng=toRad(b.lng-a.lng);
 const h=Math.sin(dLat/2)**2+Math.cos(toRad(a.lat))*Math.cos(toRad(b.lat))*Math.sin(dLng/2)**2;
 return 2*R*Math.asin(Math.sqrt(h));
}
function metersToPretty(m){return m<1000?`${Math.round(m)} m`:`${(m/1000).toFixed(2)} km`}

const redIcon=L.divIcon({className:'red-pin',html:'<div class="pin">R</div>',iconSize:[26,26]});

function initMap(){
 state.map=L.map('map').setView([14.5995,120.9842],11);
 L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png').addTo(state.map);
 state.layers.resultsLayer=L.markerClusterGroup({spiderfyOnMaxZoom:true});
 state.map.addLayer(state.layers.resultsLayer);
}

function setRef(lat,lng,label){
 state.ref={lat,lng,label};
 L.marker([lat,lng]).addTo(state.map).bindPopup(label||'Reference').openPopup();
 state.map.setView([lat,lng],15);
}

function bbox(lat,r){
 const dLat=r/111320;
 const dLng=r/(111320*Math.cos(toRad(lat))||1);
 return{dLat,dLng};
}

function candidates(ref,r){
 const {dLat,dLng}=bbox(ref.lat,r);
 const minLat=ref.lat-dLat,maxLat=ref.lat+dLat,minLng=ref.lng-dLng,maxLng=ref.lng+dLng;
 const cs=state.cellSizeDeg;
 const out=[];
 const seen=new Set();
 for(let la=Math.floor(minLat/cs);la<=Math.floor(maxLat/cs);la++){
  for(let lo=Math.floor(minLng/cs);lo<=Math.floor(maxLng/cs);lo++){
   const b=state.index[`${la}_${lo}`];if(!b)continue;
   b.forEach(i=>{if(!seen.has(i)){seen.add(i);out.push(i)}});
  }
 }
 return out.filter(i=>{
  const f=state.facilities[i];
  return f.lat>=minLat&&f.lat<=maxLat&&f.lng>=minLng&&f.lng<=maxLng;
 });
}

function runSearch(){
 if(!state.ref)return;
 const r=+radius.value;
 const idx=candidates(state.ref,r);
 const scored=[];
 idx.forEach(i=>{
  const d=haversineMeters(state.ref,state.facilities[i]);
  if(d<=r)scored.push({i,d});
 });
 scored.sort((a,b)=>a.d-b.d);

 const LIST=50,MAP=100;
 const list=scored.slice(0,LIST);
 const map=scored.slice(0,MAP);

 results.innerHTML='';
 state.layers.resultsLayer.clearLayers();

 resultsMeta.textContent=`Showing 1–${list.length} of ${scored.length} Red facilities within ${r} m`;

 map.forEach(o=>{
  const f=state.facilities[o.i];
  state.layers.resultsLayer.addLayer(
   L.marker([f.lat,f.lng],{icon:redIcon})
    .bindPopup(`<b>${f.id}</b><br>${f.property}<br>${metersToPretty(o.d)}`)
  );
 });

 list.forEach(o=>{
  const f=state.facilities[o.i];
  const li=document.createElement('li');
  li.innerHTML=`<b>${f.id}</b> ${metersToPretty(o.d)}<br>${f.property}`;
  results.appendChild(li);
 });
}

async function loadData(){
 const f=await fetch('./facilities.json');state.facilities=await f.json();
 const i=await fetch('./facilities_index.json');const idx=await i.json();
 state.index=idx.index;state.cellSizeDeg=idx.cell_size_deg;
 dataStatus.textContent=`Loaded ${state.facilities.length}`;
}

async function geocode(q){
 const r=await fetch(`https://nominatim.openstreetmap.org/search?format=json&q=${encodeURIComponent(q)}&limit=5`);
 return r.json();
}

let addrTimer=null;

function wire(){
 btnGps.onclick=()=>navigator.geolocation.getCurrentPosition(p=>{
  setRef(p.coords.latitude,p.coords.longitude,'GPS');
 });

 btnUseCoords.onclick=()=>{
  const n=coordInput.value.match(/-?\d+(\.\d+)?/g);
  if(n&&n.length>=2)setRef(+n[0],+n[1],'Manual');
 };

 btnClear.onclick=()=>location.reload();
 btnSearch.onclick=runSearch;

 addressInput.oninput=()=>{
  clearTimeout(addrTimer);
  const q=addressInput.value.trim();
  addressMatches.innerHTML='';
  if(q.length<3)return;
  addrTimer=setTimeout(async()=>{
   const r=await geocode(q);
   r.forEach(x=>{
    const d=document.createElement('div');
    d.className='match';
    d.textContent=x.display_name;
    d.onclick=()=>setRef(+x.lat,+x.lon,x.display_name);
    addressMatches.appendChild(d);
   });
  },500);
 };

 facilitySearch.oninput=()=>{
  const q=facilitySearch.value.toLowerCase();
  facilityMatches.innerHTML='';
  if(q.length<2)return;
  state.facilities.slice(0,2000).forEach(f=>{
   if(f.id.toLowerCase().includes(q)||f.property.toLowerCase().includes(q)){
    const d=document.createElement('div');
    d.className='match';
    d.textContent=f.id+' '+f.property;
    d.onclick=()=>setRef(f.lat,f.lng,f.id);
    facilityMatches.appendChild(d);
   }
  });
 };
}

(async()=>{
 initMap();
 wire();
 await loadData();
})();
