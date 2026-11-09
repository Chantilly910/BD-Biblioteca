import express, { Request, Response, NextFunction } from 'express';
import Database from 'better-sqlite3';
import bcrypt from 'bcrypt';
import { randomBytes } from 'crypto';
import path from 'path';

const app = express();
const db = new Database(path.join(process.cwd(), 'biblioteca.db'));
db.pragma('foreign_keys = ON');
db.pragma('journal_mode = WAL');
const PORT = Number(process.env.PORT || 3000);
const sessions = new Map<string,{id_usuario:number,correo:string,rol:string,expires:number}>();
const SESSION_MS = 8 * 60 * 60 * 1000;

type User = {id_usuario:number, correo:string,rol:string};
type AuthRequest = Request & { usuario?: User };
class HttpError extends Error { constructor(public status:number,message:string) { super(message); } }
const handle = (fn:(req:AuthRequest,res:Response)=>unknown) => (req:AuthRequest,res:Response) => {
  try { fn(req,res); } catch(error) { fail(res,error); }
};
function fail(res:Response,error:unknown) {
  if (!(error instanceof HttpError)) console.error(error);
  res.status(error instanceof HttpError ? error.status : 500).json({error: error instanceof HttpError ? error.message : 'Error interno del servidor'});
}
function cookie(req:Request,name:string) {
  return req.headers.cookie?.split(';').map(x=>x.trim()).find(x=>x.startsWith(name+'='))?.slice(name.length+1);
}
function auth(req:AuthRequest,res:Response,next:NextFunction) {
  const token = cookie(req,'bibliotech_session');
  const session = token && sessions.get(token);
  if (!session || session.expires < Date.now()) {
    if(token) sessions.delete(token);
    res.status(401).json({error:'Iniciá sesión para continuar'}); return;
  }
  session.expires = Date.now()+SESSION_MS;
  req.usuario = {id_usuario:session.id_usuario,correo:session.correo,rol:session.rol};
  next();
}
function admin(req:AuthRequest,res:Response,next:NextFunction) {
  if(req.usuario?.rol !== 'admin') {res.status(403).json({error:'Acceso exclusivo del administrador'});return;}
  next();
}
function id(value:unknown,label='ID') {const n = Number(value); if(!Number.isSafeInteger(n)||n<=0) throw new HttpError(400,`${label} inválido`);return n;}
const existe = (tabla:'Libros'|'Bibliotecas', campo:string, n:number) => {
  if(!db.prepare(`SELECT 1 FROM ${tabla} WHERE ${campo}=?`).get(n)) throw new HttpError(404,`${tabla} no encontrado`);
};
const libroResumen = `SELECT l.id_libro,l.titulo,l.autor,l.genero,l.precio,l.para_venta,
  COALESCE((SELECT SUM(i.stock) FROM Inventario i WHERE i.id_libro=l.id_libro),0) AS stock
  FROM Libros l`;
const operacionesSQL = `
 SELECT 'P-'||p.id_prestamo AS id_operacion,p.id_prestamo AS numero,'Préstamo' AS tipo,p.fecha_prestamo AS fecha,
 p.id_usuario,u.correo AS usuario,p.id_libro,l.titulo,p.id_biblioteca,b.nombre AS sucursal,0 AS monto,
 CASE WHEN p.fecha_devolucion IS NOT NULL THEN 'Devuelto' WHEN p.fecha_vencimiento < datetime('now') THEN 'Vencido' ELSE 'Activo' END AS estado,
 p.fecha_vencimiento,p.fecha_devolucion
 FROM Prestamos p JOIN Usuarios u ON u.id_usuario=p.id_usuario JOIN Libros l ON l.id_libro=p.id_libro JOIN Bibliotecas b ON b.id_biblioteca=p.id_biblioteca
 UNION ALL
 SELECT 'V-'||d.id_detalle,v.id_venta,'Venta',v.fecha,v.id_usuario,u.correo,d.id_libro,l.titulo,v.id_biblioteca,b.nombre,
 d.cantidad*d.precio_unitario,'Completada',NULL,NULL
 FROM Detalle_Ventas d JOIN Ventas v ON v.id_venta=d.id_venta JOIN Usuarios u ON u.id_usuario=v.id_usuario JOIN Libros l ON l.id_libro=d.id_libro JOIN Bibliotecas b ON b.id_biblioteca=v.id_biblioteca`;

app.use(express.json({limit:'100kb'}));
app.post('/api/login', async (req,res) => {
  try {
    const {correo,contrasena} = req.body || {};
    if(typeof correo!=='string'||typeof contrasena!=='string') throw new HttpError(400,'Datos de acceso inválidos');
    const u = db.prepare('SELECT * FROM Usuarios WHERE correo=?').get(correo.trim()) as (User & {contrasena_hash:string})|undefined;
    if(!u || !(await bcrypt.compare(contrasena,u.contrasena_hash))) throw new HttpError(401,'Credenciales incorrectas');
    const token=randomBytes(32).toString('hex');
    sessions.set(token,{id_usuario:u.id_usuario,correo:u.correo,rol:u.rol,expires:Date.now()+SESSION_MS});
    res.setHeader('Set-Cookie',`bibliotech_session=${token}; HttpOnly; SameSite=Lax; Path=/; Max-Age=28800${process.env.NODE_ENV==='production'?'; Secure':''}`);
    res.json({redirect:'/dashboard.html',usuario:{id_usuario:u.id_usuario,correo:u.correo,rol:u.rol}});
  } catch(error) {fail(res,error);}
});
app.post('/api/logout', (req,res)=> {const t=cookie(req,'bibliotech_session');if(t)sessions.delete(t);res.setHeader('Set-Cookie','bibliotech_session=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0');res.json({ok:true});});
app.get('/api/sesion',auth,handle((req,res)=>res.json({usuario:req.usuario})));
app.get('/api/libros',auth,handle((_req,res)=>res.json(db.prepare(`${libroResumen} ORDER BY l.titulo`).all())));
app.get('/api/libros/:id',auth,handle((req,res)=>{
 const n=id(req.params.id);const libro=db.prepare(`${libroResumen} WHERE l.id_libro=?`).get(n);
 if(!libro)throw new HttpError(404,'Libro no encontrado');
 const sucursales=db.prepare(`SELECT b.id_biblioteca,b.nombre,COALESCE(i.stock,0) stock FROM Bibliotecas b LEFT JOIN Inventario i ON i.id_biblioteca=b.id_biblioteca AND i.id_libro=? ORDER BY b.id_biblioteca`).all(n);
 res.json({libro,sucursales});
}));
app.get('/api/sucursales',auth,handle((_req,res)=>res.json(db.prepare('SELECT * FROM Bibliotecas ORDER BY id_biblioteca').all())));
app.get('/api/usuarios',auth,admin,handle((_req,res)=>res.json(db.prepare('SELECT id_usuario,correo,rol FROM Usuarios ORDER BY id_usuario').all())));
app.get('/api/prestamos',auth,handle((req,res)=>{
 const usuario=req.usuario!; const pedido=req.query.id_usuario ? id(req.query.id_usuario,'Usuario') : usuario.id_usuario;
 if(usuario.rol!=='admin'&&usuario.id_usuario!==pedido)throw new HttpError(403,'Solo podés ver tus préstamos');
 res.json(db.prepare(`SELECT p.*,l.titulo,b.nombre AS sucursal,u.correo,
 CASE WHEN p.fecha_devolucion IS NOT NULL THEN 'Devuelto' WHEN p.fecha_vencimiento < datetime('now') THEN 'Vencido' ELSE 'Activo' END estado
 FROM Prestamos p JOIN Libros l ON l.id_libro=p.id_libro JOIN Bibliotecas b ON b.id_biblioteca=p.id_biblioteca JOIN Usuarios u ON u.id_usuario=p.id_usuario
 WHERE p.id_usuario=? ORDER BY p.fecha_prestamo DESC,p.id_prestamo DESC`).all(pedido));
}));
app.post('/api/prestamos/:id/devolver',auth,handle((req,res)=>{
 const p=id(req.params.id,'Préstamo');
 const devolver=db.transaction(()=>{
  const prestamo=db.prepare('SELECT * FROM Prestamos WHERE id_prestamo=?').get(p) as any;
  if(!prestamo)throw new HttpError(404,'Préstamo no encontrado');
  if(req.usuario!.rol!=='admin'&&req.usuario!.id_usuario!==prestamo.id_usuario)throw new HttpError(403,'No podés devolver este préstamo');
  if(prestamo.fecha_devolucion)throw new HttpError(409,'El préstamo ya fue devuelto');
  db.prepare("UPDATE Prestamos SET fecha_devolucion=datetime('now') WHERE id_prestamo=?").run(p);
  db.prepare('UPDATE Inventario SET stock=stock+1 WHERE id_libro=? AND id_biblioteca=?').run(prestamo.id_libro,prestamo.id_biblioteca);
 }); devolver();res.json({ok:true});
}));
app.post('/api/operaciones',auth,handle((req,res)=>{
 const {items,id_biblioteca}=req.body||{};
 const sucursal=id(id_biblioteca,'Sucursal');existe('Bibliotecas','id_biblioteca',sucursal);
 if(!Array.isArray(items)||!items.length||items.length>30)throw new HttpError(400,'Seleccioná entre 1 y 30 libros');
 const registrar=db.transaction(()=>{
  const validos=items.map((item:any)=>{
    const libroId=id(item?.id_libro,'Libro');const tipo=item?.tipo;
    if(tipo!=='Prestar'&&tipo!=='Comprar')throw new HttpError(400,'Tipo de operación inválido');
    const l=db.prepare('SELECT * FROM Libros WHERE id_libro=?').get(libroId) as any;
    if(!l)throw new HttpError(404,'Libro no encontrado');
    if(tipo==='Comprar'&&!l.para_venta)throw new HttpError(409,`${l.titulo} no está disponible para venta`);
    return {l,tipo};
  });
  const conteo=new Map<number,number>();
  for(const v of validos) conteo.set(v.l.id_libro,(conteo.get(v.l.id_libro)||0)+1);
  for(const [libroId,cantidad] of conteo) {
    const result=db.prepare('UPDATE Inventario SET stock=stock-? WHERE id_libro=? AND id_biblioteca=? AND stock>=?').run(cantidad,libroId,sucursal,cantidad);
    if(result.changes!==1)throw new HttpError(409,'Stock insuficiente en la sucursal seleccionada');
  }
  let ventaId:number|null=null,total=0,prestamos=0,ventas=0;
  const insertarVenta=db.prepare('INSERT INTO Ventas (id_usuario,id_biblioteca,total) VALUES (?,?,0)');
  const insertarDetalle=db.prepare('INSERT INTO Detalle_Ventas (id_venta,id_libro,cantidad,precio_unitario) VALUES (?,?,1,?)');
  const insertarPrestamo=db.prepare("INSERT INTO Prestamos (id_usuario,id_libro,id_biblioteca,fecha_vencimiento) VALUES (?,?,?,datetime('now','+14 days'))");
  for(const {l,tipo} of validos) {
    if(tipo==='Comprar') {
      if(ventaId===null)ventaId=Number(insertarVenta.run(req.usuario!.id_usuario,sucursal).lastInsertRowid);
      insertarDetalle.run(ventaId,l.id_libro,l.precio);total+=l.precio;ventas++;
    } else {insertarPrestamo.run(req.usuario!.id_usuario,l.id_libro,sucursal);prestamos++;}
  }
  if(ventaId!==null)db.prepare('UPDATE Ventas SET total=? WHERE id_venta=?').run(total,ventaId);
  return {ok:true,ventaId,total,prestamos,ventas};
 });
 res.status(201).json(registrar());
}));
app.get('/api/bi/sucursales',auth,admin,handle((_req,res)=>res.json(db.prepare(`
 SELECT b.id_biblioteca,b.nombre,
 (SELECT COUNT(*) FROM Prestamos p WHERE p.id_biblioteca=b.id_biblioteca) +
 (SELECT COALESCE(SUM(d.cantidad),0) FROM Ventas v JOIN Detalle_Ventas d ON d.id_venta=v.id_venta WHERE v.id_biblioteca=b.id_biblioteca) AS operaciones,
 (SELECT COALESCE(SUM(i.stock),0) FROM Inventario i WHERE i.id_biblioteca=b.id_biblioteca) AS stock
 FROM Bibliotecas b ORDER BY b.id_biblioteca`).all())));
app.get('/api/bi/sucursales/:id/libros',auth,admin,handle((req,res)=>{
 const sucursal=id(req.params.id);existe('Bibliotecas','id_biblioteca',sucursal);
 res.json(db.prepare(`SELECT l.id_libro,l.titulo,l.autor,l.genero,COALESCE(i.stock,0) stock,
 (SELECT COUNT(*) FROM Prestamos p WHERE p.id_biblioteca=? AND p.id_libro=l.id_libro)+
 (SELECT COALESCE(SUM(d.cantidad),0) FROM Detalle_Ventas d JOIN Ventas v ON v.id_venta=d.id_venta WHERE v.id_biblioteca=? AND d.id_libro=l.id_libro) AS operaciones
 FROM Libros l LEFT JOIN Inventario i ON i.id_libro=l.id_libro AND i.id_biblioteca=? ORDER BY operaciones DESC,l.titulo`).all(sucursal,sucursal,sucursal));
}));
app.get('/api/bi/sucursales/:sucursal/libros/:libro/operaciones',auth,admin,handle((req,res)=>{
 const sucursal=id(req.params.sucursal), libro=id(req.params.libro);existe('Bibliotecas','id_biblioteca',sucursal);existe('Libros','id_libro',libro);
 res.json(db.prepare(`SELECT * FROM (${operacionesSQL}) WHERE id_biblioteca=? AND id_libro=? ORDER BY fecha DESC,id_operacion DESC`).all(sucursal,libro));
}));
app.get('/api/bi/operaciones/:codigo',auth,admin,handle((req,res)=>{
 const codigo=String(req.params.codigo);if(!/^[PV]-[1-9][0-9]*$/.test(codigo))throw new HttpError(400,'Código inválido');
 const op=db.prepare(`SELECT * FROM (${operacionesSQL}) WHERE id_operacion=?`).get(codigo);
 if(!op)throw new HttpError(404,'Operación no encontrada');res.json(op);
}));

app.use('/api',(_req,res)=>res.status(404).json({error:'Endpoint no encontrado'}));
app.use(express.static(path.join(process.cwd(),'public')));
app.listen(PORT,()=>console.log(`BiblioTech: http://localhost:${PORT}`));
