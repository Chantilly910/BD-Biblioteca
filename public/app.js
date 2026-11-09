'use strict';
const money = new Intl.NumberFormat('es-AR',{style:'currency',currency:'ARS',maximumFractionDigits:0});
const $ = id => document.getElementById(id);
let usuario=null, libros=[], sucursales=[], carrito=[], chart=null, sucursalBI=null, libroBI=null, operacionBI=null;
let navVersion=0;
function escapeHTML(value) {return String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));}
function fecha(value) {return value ? new Date(value.replace(' ','T')+'Z').toLocaleString('es-AR',{dateStyle:'short',timeStyle:'short'}) : '—';}
function aviso(texto,error=false) {const n=$('toast');n.innerHTML=`<div class="toast-alert" style="background:${error?'#991b1b':'#0f172a'}">${escapeHTML(texto)}</div>`; clearTimeout(aviso.timer);aviso.timer=setTimeout(()=>n.innerHTML='',4200);}
async function api(url,opciones={}) {
 const r=await fetch(url,{credentials:'same-origin',...opciones,headers:{'Content-Type':'application/json',...(opciones.headers||{})}});
 const result=await r.json().catch(()=>({}));
 if(r.status===401){localStorage.removeItem('usuarioLogueado');location.replace('/');throw new Error('Sesión vencida');}
 if(!r.ok)throw new Error(result.error || `Error HTTP ${r.status}`);
 return result;
}
async function iniciar(){
 try {
   const sesion=await api('/api/sesion'); usuario=sesion.usuario;
   $('userName').textContent=usuario.correo;$('userRole').textContent=usuario.rol;
   if(usuario.rol==='admin') document.querySelectorAll('.admin-only').forEach(x=>x.style.display='block');
   [libros,sucursales]=await Promise.all([api('/api/libros'),api('/api/sucursales')]);
   $('cartSucursal').innerHTML=sucursales.map(s=>`<option value="${s.id_biblioteca}">${escapeHTML(s.nombre)}</option>`).join('');
   renderizarCatalogo(libros);
   if(usuario.rol==='admin')await cargarUsuariosBD();
   const initial=usuario.rol==='admin'?'bi':'catalogo';
   const seccion=['bi','catalogo','usuarios','prestamos'].includes(location.hash.slice(1)) ? location.hash.slice(1) : initial;
   const autorizada=usuario.rol==='admin'||!['bi','usuarios'].includes(seccion);
   history.replaceState({tipo:'seccion',id:autorizada?seccion:initial},'',`#${autorizada?seccion:initial}`);
   await cambiarSeccion(autorizada?seccion:initial,false);
 }catch(e){aviso(e.message,true);}
}
async function cerrarSesion(){try{await fetch('/api/logout',{method:'POST'});}finally{localStorage.removeItem('usuarioLogueado');location.replace('/');}}
async function cambiarSeccion(seccion,push=true){
 if(!usuario || (usuario.rol!=='admin'&&['bi','usuarios'].includes(seccion)))return;
 if(!$('seccion-'+seccion))return;
 document.querySelectorAll('.seccion').forEach(e=>e.classList.remove('activa'));
 document.querySelectorAll('.nav-item').forEach(e=>e.classList.remove('active'));
 $('seccion-'+seccion).classList.add('activa');$('nav-'+seccion)?.classList.add('active');
 $('titulo-seccion').textContent=({bi:'Tablero Directivo (BI)',catalogo:'Catálogo Interactivo',usuarios:'Gestión de Usuarios',prestamos:'Mis Préstamos'})[seccion];
 if(push)history.pushState({tipo:'seccion',id:seccion},'',`#${seccion}`);
 if(seccion==='bi'){await mostrarNivel(1,false);}
 if(seccion==='prestamos')await cargarPrestamos();
 if(seccion==='usuarios')await cargarUsuariosBD();
}
window.addEventListener('popstate',async e=>{
 const state=e.state;if(!state)return;
 try{
  if(state.tipo==='seccion')await cambiarSeccion(state.id,false);
  if(state.tipo==='nivel'){await cambiarSeccion('bi',false);await mostrarNivel(state.nivel,false,state.sucursal,state.libro,state.operacion);}
 }catch(err){aviso(err.message,true);}
});
async function mostrarNivel(nivel,push=true,sucursal=sucursalBI,libro=libroBI,operacion=operacionBI){
 if(usuario?.rol!=='admin')return;
 const version=++navVersion;
 ['nivel-1','nivel-2','nivel-3','nivel-4'].forEach(k=>$(k).classList.add('hidden'));
 const migas=[`<a href="#bi-nivel-1" data-level="1">Corporativo</a>`];
 try{
  if(nivel>=2){
   sucursalBI=Number(sucursal);const s=sucursales.find(x=>x.id_biblioteca===sucursalBI);if(!s)throw Error('Sucursal no encontrada');
   migas.push(`<a href="#bi-nivel-2" data-level="2" data-sucursal="${sucursalBI}">${escapeHTML(s.nombre)}</a>`);
  }
  if(nivel>=3){
   libroBI=Number(libro);const l=libros.find(x=>x.id_libro===libroBI);if(!l)throw Error('Libro no encontrado');
   migas.push(`<a href="#bi-nivel-3" data-level="3" data-sucursal="${sucursalBI}" data-libro="${libroBI}">${escapeHTML(l.titulo)}</a>`);
  }
  if(nivel>=4){operacionBI=String(operacion);migas.push(escapeHTML(operacionBI));}
  if(nivel===1){await cargarGrafico();}
  if(nivel===2){await cargarLibrosBI();}
  if(nivel===3){await cargarOperacionesBI();}
  if(nivel===4){await cargarOperacionBI();}
  if(version!==navVersion)return;
  $('migas-pan').innerHTML=migas.join(' &gt; ');
  $('nivel-'+nivel).classList.remove('hidden');
  if(push)history.pushState({tipo:'nivel',nivel,sucursal:sucursalBI,libro:libroBI,operacion:operacionBI},'',`#bi-nivel-${nivel}`);
 }catch(e){aviso(e.message,true);$('nivel-1').classList.remove('hidden');}
}
$('migas-pan').addEventListener('click',e=>{
 const a=e.target.closest('[data-level]');if(!a)return;e.preventDefault();mostrarNivel(Number(a.dataset.level),true,a.dataset.sucursal,a.dataset.libro);
});
async function cargarGrafico(){
 const data=await api('/api/bi/sucursales');const ctx=$('graficoBI').getContext('2d');
 if(chart)chart.destroy();
 chart=new Chart(ctx,{type:'bar',data:{labels:data.map(x=>x.nombre),datasets:[{label:'Operaciones registradas',data:data.map(x=>x.operaciones),backgroundColor:'#38bdf8',borderRadius:6}]},
 options:{responsive:true,maintainAspectRatio:false,scales:{y:{beginAtZero:true,ticks:{precision:0}}},onClick:(_e,els)=>{if(els.length)mostrarNivel(2,true,data[els[0].index].id_biblioteca);}}});
}
async function cargarLibrosBI(){
 const suc=sucursales.find(x=>x.id_biblioteca===sucursalBI);
 $('titulo-nivel-2').textContent=`Catálogo de ${suc.nombre} · Stock por libro`;
 const data=await api(`/api/bi/sucursales/${sucursalBI}/libros`);
 $('tabla-bi-libros').innerHTML=data.map(l=>{
 const cls=l.stock===0?'rojo':l.stock<=2?'amarillo':'verde';
 return `<tr class="cursor-pointer" data-libro="${l.id_libro}"><td>${escapeHTML(l.titulo)}</td><td>${l.operaciones}</td><td><span class="semaforo ${cls}"></span>${l.stock} un.</td></tr>`;
 }).join('') || '<tr><td colspan="3">Sin libros</td></tr>';
}
$('tabla-bi-libros').addEventListener('click',e=>{const tr=e.target.closest('[data-libro]');if(tr)mostrarNivel(3,true,sucursalBI,Number(tr.dataset.libro));});
async function cargarOperacionesBI(){
 const l=libros.find(x=>x.id_libro===libroBI);
 $('titulo-nivel-3').textContent=`Historial de ${l.titulo}`;
 const ops=await api(`/api/bi/sucursales/${sucursalBI}/libros/${libroBI}/operaciones`);
 $('tabla-bi-operaciones').innerHTML=ops.map(o=>`<tr class="cursor-pointer" data-operacion="${escapeHTML(o.id_operacion)}"><td>${escapeHTML(o.id_operacion)}</td><td>${fecha(o.fecha)}</td><td>${escapeHTML(o.tipo)}</td><td>${escapeHTML(o.usuario)}</td><td>${money.format(o.monto)}</td><td>${escapeHTML(o.estado)}</td></tr>`).join('')||'<tr><td colspan="6">Todavía no hay transacciones para este libro.</td></tr>';
}
$('tabla-bi-operaciones').addEventListener('click',e=>{const tr=e.target.closest('[data-operacion]');if(tr)mostrarNivel(4,true,sucursalBI,libroBI,tr.dataset.operacion);});
async function cargarOperacionBI(){
 const o=await api('/api/bi/operaciones/'+encodeURIComponent(operacionBI));
 $('detalle-operacion').innerHTML=`<table><tbody>${[
 ['ID de operación',o.id_operacion],['Tipo',o.tipo],['Fecha',fecha(o.fecha)],['Libro',o.titulo],['Sucursal',o.sucursal],
 ['Usuario',o.usuario],['ID de usuario',o.id_usuario],['Importe',money.format(o.monto)],['Estado',o.estado],
 ...(o.tipo==='Préstamo'?[['Vencimiento',fecha(o.fecha_vencimiento)],['Devolución',fecha(o.fecha_devolucion)]]:[])
 ].map(([k,v])=>`<tr><th>${escapeHTML(k)}</th><td>${escapeHTML(v)}</td></tr>`).join('')}</tbody></table>`;
}
function renderizarCatalogo(lista){
 $('grid-libros').innerHTML=lista.map(l=>`<div class="libro-card"><div class="libro-portada">${escapeHTML(l.titulo[0].toUpperCase())}</div><div class="libro-info">
 <div class="libro-titulo">${escapeHTML(l.titulo)}</div><div class="libro-autor">${escapeHTML(l.autor)} · ${escapeHTML(l.genero)}</div>
 <div class="libro-precio">${l.para_venta?money.format(l.precio):'Solo préstamo'}</div><p style="font-size:13px;color:#64748b;margin-bottom:12px">Stock total: ${l.stock}</p>
 <div class="card-actions"><button class="btn-accion btn-detalle" data-action="detalle" data-id="${l.id_libro}">Detalles</button>
 <button class="btn-accion btn-prestar" data-action="Prestar" data-id="${l.id_libro}" ${l.stock<=0?'disabled':''}>Prestar</button>
 ${l.para_venta?`<button class="btn-accion btn-comprar" data-action="Comprar" data-id="${l.id_libro}" ${l.stock<=0?'disabled':''}>Comprar</button>`:''}</div></div></div>`).join('')||'<p>No se encontraron libros.</p>';
}
$('grid-libros').addEventListener('click',e=>{
 const b=e.target.closest('button[data-action]');if(!b)return;
 const n=Number(b.dataset.id);
 if(b.dataset.action==='detalle')verFicha(n);else agregarAlCarrito(n,b.dataset.action);
});
function filtrarCatalogo(){const t=$('buscador').value.toLocaleLowerCase('es');renderizarCatalogo(libros.filter(l=>[l.titulo,l.autor,l.genero].some(x=>x.toLocaleLowerCase('es').includes(t))));}
async function verFicha(n){
 try{
 const {libro:l,sucursales:inventario}=await api(`/api/libros/${n}`);
 $('contenido-ficha').innerHTML=`<h2 style="margin-bottom:12px">${escapeHTML(l.titulo)}</h2><p><strong>Autor:</strong> ${escapeHTML(l.autor)}</p><p><strong>Género:</strong> ${escapeHTML(l.genero)}</p>
 <p><strong>Modalidad:</strong> ${l.para_venta?'Venta y préstamo':'Solo préstamo'}</p><p><strong>Precio:</strong> ${l.para_venta?money.format(l.precio):'No aplica'}</p>
 <p><strong>Disponibilidad total:</strong> ${l.stock} ejemplares</p><h3 style="margin:22px 0 10px">Existencias por sucursal</h3>
 <table><thead><tr><th>Sucursal</th><th>Ejemplares disponibles</th></tr></thead><tbody>${inventario.map(i=>`<tr><td>${escapeHTML(i.nombre)}</td><td>${i.stock}</td></tr>`).join('')}</tbody></table>
 <div style="margin-top:22px" class="card-actions"><button class="btn-accion btn-prestar" data-action="Prestar" ${l.stock<=0?'disabled':''}>Solicitar préstamo</button>${l.para_venta?`<button class="btn-accion btn-comprar" data-action="Comprar" ${l.stock<=0?'disabled':''}>Comprar</button>`:''}</div>`;
 $('contenido-ficha').querySelectorAll('[data-action]').forEach(b=>b.addEventListener('click',()=>{agregarAlCarrito(n,b.dataset.action);cerrarFicha();}));
 $('modal-libro').classList.remove('hidden');
 }catch(e){aviso(e.message,true);}
}
function cerrarFicha(){$('modal-libro').classList.add('hidden');}
$('modal-libro').addEventListener('click',e=>{if(e.target===$('modal-libro'))cerrarFicha();});
function toggleCarrito(){$('cartPanel').classList.toggle('open');}
function agregarAlCarrito(n,tipo){
 const l=libros.find(x=>x.id_libro===n);if(!l)return;
 const seleccion=carrito.filter(i=>i.id_libro===n).length;
 if(l.stock<=seleccion){aviso('No hay stock total suficiente',true);return;}
 carrito.push({id_libro:n,titulo:l.titulo,tipo,precio:tipo==='Comprar'?l.precio:0});
 actualizarCarritoUI();$('cartPanel').classList.add('open');
}
function eliminarDelCarrito(index){carrito.splice(index,1);actualizarCarritoUI();}
function actualizarCarritoUI(){
 $('cart-count').textContent=carrito.length;
 const total=carrito.reduce((n,i)=>n+i.precio,0);
 $('cartTotal').textContent=money.format(total);
 $('cartItems').innerHTML=carrito.map((i,index)=>`<div class="cart-item"><div><strong>${escapeHTML(i.titulo)}</strong><p style="margin-top:6px;font-size:13px">${i.tipo} · ${i.precio?money.format(i.precio):'Gratis'}</p></div><button class="btn-remove" data-index="${index}">Quitar</button></div>`).join('')||'<p style="color:#64748b;text-align:center;margin:40px 0">El carrito está vacío</p>';
}
$('cartItems').addEventListener('click',e=>{const b=e.target.closest('[data-index]');if(b)eliminarDelCarrito(Number(b.dataset.index));});
async function procesarCheckout(){
 if(!carrito.length)return aviso('El carrito está vacío',true);
 const btn=document.querySelector('.btn-checkout');btn.disabled=true;
 try{
  const result=await api('/api/operaciones',{method:'POST',body:JSON.stringify({id_biblioteca:Number($('cartSucursal').value),items:carrito.map(i=>({id_libro:i.id_libro,tipo:i.tipo}))})});
  carrito=[];actualizarCarritoUI();$('cartPanel').classList.remove('open');
  libros=await api('/api/libros');filtrarCatalogo();
  aviso(`Registrado: ${result.prestamos} préstamo(s), ${result.ventas} venta(s). Total ${money.format(result.total)}`);
  if($('seccion-bi').classList.contains('activa'))await mostrarNivel(1,false);
  if($('seccion-prestamos').classList.contains('activa'))await cargarPrestamos();
 }catch(e){aviso(e.message,true);}finally{btn.disabled=false;}
}
async function cargarPrestamos(usuarioId=null){
 try{
  const url='/api/prestamos'+(usuarioId?`?id_usuario=${usuarioId}`:'');
  const data=await api(url);
  $('prestamos-titulo').textContent=usuarioId?`Préstamos de ${usuarioId}`:'Historial de mis préstamos';
  $('tabla-prestamos').innerHTML=data.map(p=>`<tr><td>${escapeHTML(p.titulo)}</td><td>${escapeHTML(p.sucursal)}</td><td>${fecha(p.fecha_prestamo)}</td><td>${fecha(p.fecha_vencimiento)}</td><td>${fecha(p.fecha_devolucion)}</td><td>${escapeHTML(p.estado)}</td><td>${p.estado!=='Devuelto'?`<button class="btn-accion btn-prestar" data-devolver="${p.id_prestamo}">Devolver</button>`:'—'}</td></tr>`).join('')||'<tr><td colspan="7">Sin préstamos registrados.</td></tr>';
 }catch(e){aviso(e.message,true);}
}
$('tabla-prestamos').addEventListener('click',async e=>{
 const b=e.target.closest('[data-devolver]');if(!b)return;b.disabled=true;
 try{await api(`/api/prestamos/${b.dataset.devolver}/devolver`,{method:'POST'});libros=await api('/api/libros');filtrarCatalogo();await cargarPrestamos();aviso('Devolución registrada. Stock reintegrado.');}
 catch(err){aviso(err.message,true);b.disabled=false;}
});
async function cargarUsuariosBD(){
 if(usuario?.rol!=='admin')return;
 try{
 const data=await api('/api/usuarios');
 $('tabla-usuarios-bd').innerHTML=data.map(u=>`<tr><td>#${u.id_usuario}</td><td>${escapeHTML(u.correo)}</td><td>${escapeHTML(u.rol)}</td><td><button class="btn-accion btn-detalle" data-usuario="${u.id_usuario}">Ver préstamos</button></td></tr>`).join('');
 }catch(e){aviso(e.message,true);}
}
$('tabla-usuarios-bd').addEventListener('click',async e=>{
 const b=e.target.closest('[data-usuario]');if(!b)return;
 await cambiarSeccion('prestamos');await cargarPrestamos(Number(b.dataset.usuario));
});
iniciar();
