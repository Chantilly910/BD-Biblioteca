import Database from 'better-sqlite3';
import bcrypt from 'bcrypt';
import path from 'path';

const db = new Database(path.join(process.cwd(), 'biblioteca.db'));
db.pragma('foreign_keys = ON');
db.pragma('journal_mode = WAL');

async function inicializar() {
  db.exec(`
    CREATE TABLE IF NOT EXISTS Usuarios (
      id_usuario INTEGER PRIMARY KEY AUTOINCREMENT,
      correo TEXT NOT NULL UNIQUE,
      contrasena_hash TEXT NOT NULL,
      rol TEXT NOT NULL CHECK (rol IN ('admin','lector'))
    );
    CREATE TABLE IF NOT EXISTS Libros (
      id_libro INTEGER PRIMARY KEY AUTOINCREMENT,
      titulo TEXT NOT NULL,
      autor TEXT NOT NULL,
      genero TEXT NOT NULL,
      stock INTEGER NOT NULL DEFAULT 5,
      precio REAL NOT NULL CHECK (precio >= 0),
      para_venta INTEGER NOT NULL DEFAULT 1 CHECK (para_venta IN (0,1))
    );
    CREATE TABLE IF NOT EXISTS Bibliotecas (
      id_biblioteca INTEGER PRIMARY KEY AUTOINCREMENT,
      nombre TEXT NOT NULL UNIQUE
    );
    CREATE TABLE IF NOT EXISTS Inventario (
      id_biblioteca INTEGER NOT NULL REFERENCES Bibliotecas(id_biblioteca),
      id_libro INTEGER NOT NULL REFERENCES Libros(id_libro),
      stock INTEGER NOT NULL DEFAULT 0 CHECK (stock >= 0),
      PRIMARY KEY (id_biblioteca, id_libro)
    );
    CREATE TABLE IF NOT EXISTS Prestamos (
      id_prestamo INTEGER PRIMARY KEY AUTOINCREMENT,
      id_usuario INTEGER NOT NULL REFERENCES Usuarios(id_usuario),
      id_libro INTEGER NOT NULL REFERENCES Libros(id_libro),
      id_biblioteca INTEGER NOT NULL REFERENCES Bibliotecas(id_biblioteca),
      fecha_prestamo TEXT NOT NULL DEFAULT (datetime('now')),
      fecha_vencimiento TEXT NOT NULL,
      fecha_devolucion TEXT
    );
    CREATE TABLE IF NOT EXISTS Ventas (
      id_venta INTEGER PRIMARY KEY AUTOINCREMENT,
      id_usuario INTEGER NOT NULL REFERENCES Usuarios(id_usuario),
      id_biblioteca INTEGER NOT NULL REFERENCES Bibliotecas(id_biblioteca),
      fecha TEXT NOT NULL DEFAULT (datetime('now')),
      total REAL NOT NULL DEFAULT 0
    );
    CREATE TABLE IF NOT EXISTS Detalle_Ventas (
      id_detalle INTEGER PRIMARY KEY AUTOINCREMENT,
      id_venta INTEGER NOT NULL REFERENCES Ventas(id_venta),
      id_libro INTEGER NOT NULL REFERENCES Libros(id_libro),
      cantidad INTEGER NOT NULL CHECK (cantidad > 0),
      precio_unitario REAL NOT NULL CHECK (precio_unitario >= 0)
    );
    CREATE INDEX IF NOT EXISTS idx_prestamos_usuario ON Prestamos(id_usuario);
    CREATE INDEX IF NOT EXISTS idx_prestamos_libro_sucursal ON Prestamos(id_libro,id_biblioteca);
    CREATE INDEX IF NOT EXISTS idx_ventas_sucursal ON Ventas(id_biblioteca);
  `);

  for (const [correo, clave, rol] of [
    ['admin@biblioteca.com', 'admin123', 'admin'],
    ['lector@biblioteca.com', 'lector123', 'lector']
  ]) {
    if (!db.prepare('SELECT 1 FROM Usuarios WHERE correo=?').get(correo)) {
      db.prepare('INSERT INTO Usuarios (correo,contrasena_hash,rol) VALUES (?,?,?)')
        .run(correo, await bcrypt.hash(clave, 10), rol);
    }
  }

  const libros: [string,string,string][] = [
    ['1984','George Orwell','Ficción'], ['El Aleph','Jorge Luis Borges','Cuentos'], ['Clean Code','Robert C. Martin','Informática'],
    ['Fahrenheit 451','Ray Bradbury','Ficción'], ['Don Quijote','Miguel de Cervantes','Clásico'], ['Cien años de soledad','García Márquez','Ficción'],
    ['Sapiens','Yuval Noah Harari','Historia'], ['El Principito','Antoine de Saint-Exupéry','Infantil'], ['Design Patterns','Gang of Four','Informática'],
    ['Hábitos Atómicos','James Clear','Desarrollo'], ['Dune','Frank Herbert','Ciencia Ficción'], ['Fundación','Isaac Asimov','Ciencia Ficción'],
    ['La Odisea','Homero','Clásico'], ['El Señor de los Anillos','J.R.R. Tolkien','Fantasía'], ['Harry Potter 1','J.K. Rowling','Fantasía'],
    ['Neuromante','William Gibson','Ficción'], ['El retrato de Dorian Gray','Oscar Wilde','Clásico'], ['Frankenstein','Mary Shelley','Clásico'],
    ['Drácula','Bram Stoker','Terror'], ['Un mundo feliz','Aldous Huxley','Ficción'], ['Orgullo y Prejuicio','Jane Austen','Romance'],
    ['Moby Dick','Herman Melville','Aventura'], ['Crimen y Castigo','Fiódor Dostoyevski','Clásico'], ['El Alquimista','Paulo Coelho','Ficción'],
    ['La sombra del viento','Carlos Ruiz Zafón','Misterio'], ['Rayuela','Julio Cortázar','Ficción'], ['El nombre de la rosa','Umberto Eco','Misterio'],
    ['Los pilares de la Tierra','Ken Follett','Histórica'], ['Snow Crash','Neal Stephenson','Ciencia Ficción'], ['Algoritmos','Thomas H. Cormen','Informática']
  ];
  if ((db.prepare('SELECT COUNT(*) n FROM Libros').get() as {n:number}).n === 0) {
    const insertar = db.prepare('INSERT INTO Libros (titulo,autor,genero,precio,para_venta) VALUES (?,?,?,?,?)');
    db.transaction(() => {
      for (const [titulo,autor,genero] of libros) {
        insertar.run(titulo,autor,genero,25000 + Math.floor(Math.random()*25001), Math.random() > .3 ? 1 : 0);
      }
    })();
  }
  const agregarSucursal = db.prepare('INSERT OR IGNORE INTO Bibliotecas (nombre) VALUES (?)');
  for (const nombre of ['Centro','Norte','Sur']) agregarSucursal.run(nombre);

  // Migración no destructiva: solo repartir existencias de libros que aún no tienen inventario.
  const sinInventario = db.prepare(`SELECT id_libro, stock FROM Libros l WHERE NOT EXISTS
    (SELECT 1 FROM Inventario i WHERE i.id_libro=l.id_libro)`).all() as {id_libro:number,stock:number}[];
  const sucursales = db.prepare('SELECT id_biblioteca FROM Bibliotecas ORDER BY id_biblioteca').all() as {id_biblioteca:number}[];
  const insertarStock = db.prepare('INSERT INTO Inventario (id_biblioteca,id_libro,stock) VALUES (?,?,?)');
  db.transaction(() => {
    for (const libro of sinInventario) {
      const total = Math.max(0, libro.stock);
      sucursales.forEach((s, index) => {
        const cantidad = Math.floor(total/sucursales.length) + (index < total % sucursales.length ? 1 : 0);
        insertarStock.run(s.id_biblioteca, libro.id_libro, cantidad);
      });
    }
  })();
  console.log('✅ Base de datos inicializada sin eliminar datos existentes.');
  db.close();
}
inicializar().catch(err => { console.error(err); db.close(); process.exitCode = 1; });
