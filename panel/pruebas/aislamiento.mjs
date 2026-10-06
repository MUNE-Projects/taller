// Prueba automática de aislamiento entre promotoras.
//
// Levanta una base de datos de Supabase local y vacía (con `supabase start`,
// nunca la real), le aplica los archivos de panel/supabase en orden, como
// se hace en el SQL Editor, crea dos promotoras inventadas (A y B) y
// comprueba, con la misma clave pública que usan las páginas, que:
//  · todos los intentos de saltarse las reglas FALLAN;
//  · el uso normal SIGUE FUNCIONANDO.
//
// Uso (desde panel/, con el Supabase local en marcha en panel/pruebas):
//   node pruebas/aislamiento.mjs
// Variables: SUPABASE_URL, SUPABASE_ANON_KEY, SUPABASE_SERVICE_KEY, DB_URL
// (las imprime `supabase status -o env`). Por seguridad, solo acepta
// direcciones locales.

import { createClient } from '@supabase/supabase-js';
import { execFileSync } from 'node:child_process';
import { createHash, createHmac } from 'node:crypto';
import { appendFileSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const { SUPABASE_URL, SUPABASE_ANON_KEY, SUPABASE_SERVICE_KEY, DB_URL } = process.env;
if ( ! SUPABASE_URL || ! SUPABASE_ANON_KEY || ! SUPABASE_SERVICE_KEY || ! DB_URL ) {

	console.error( 'Faltan SUPABASE_URL, SUPABASE_ANON_KEY, SUPABASE_SERVICE_KEY o DB_URL' );
	process.exit( 2 );

}
const local = ( u ) => /^[a-z]+:\/\/([^@/]*@)?(127\.0\.0\.1|localhost)(:\d+)?(\/|$)/.test( u );
if ( ! local( SUPABASE_URL ) || ! local( DB_URL ) ) {

	console.error( 'Esta prueba solo se ejecuta contra un Supabase local, nunca contra el real.' );
	process.exit( 2 );

}

const SQL = join( dirname( fileURLToPath( import.meta.url ) ), '..', 'supabase' );
const CLAVE = 'prueba-aislamiento-123';
const opciones = { auth: { persistSession: false, autoRefreshToken: false } };
const servicio = createClient( SUPABASE_URL, SUPABASE_SERVICE_KEY, opciones );
const nuevo = () => createClient( SUPABASE_URL, SUPABASE_ANON_KEY, opciones );

// ─── Utilidades ─────────────────────────────────────────────────────────────

function aplicar( archivo ) {

	execFileSync( 'psql', [ DB_URL, '-q', '-v', 'ON_ERROR_STOP=1', '-f', join( SQL, archivo ) ], { stdio: [ 'ignore', 'ignore', 'inherit' ], env: { ...process.env, PGOPTIONS: '-c client_min_messages=warning' } } );

}

async function crearUsuario( email ) {

	const { data, error } = await servicio.auth.admin.createUser( { email, password: CLAVE, email_confirm: true } );
	if ( error ) throw new Error( `crear ${ email }: ${ error.message }` );
	return data.user.id;

}

async function entrar( email ) {

	const sb = nuevo();
	const { error } = await sb.auth.signInWithPassword( { email, password: CLAVE } );
	if ( error ) throw new Error( `entrar ${ email }: ${ error.message }` );
	return sb;

}

// Código del móvil (TOTP, RFC 6238) a partir del secreto en base 32.
function codigoTotp( secreto ) {

	const alfabeto = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
	let bits = '';
	for ( const c of secreto.replace( /=+$/, '' ).toUpperCase() ) bits += alfabeto.indexOf( c ).toString( 2 ).padStart( 5, '0' );
	const clave = Buffer.from( bits.match( /.{8}/g ).map( ( b ) => parseInt( b, 2 ) ) );
	const contador = Buffer.alloc( 8 );
	contador.writeBigUInt64BE( BigInt( Math.floor( Date.now() / 30000 ) ) );
	const h = createHmac( 'sha1', clave ).update( contador ).digest();
	const o = h[ h.length - 1 ] & 0xf;
	return String( ( h.readUInt32BE( o ) & 0x7fffffff ) % 1e6 ).padStart( 6, '0' );

}

const huella = ( buf ) => createHash( 'sha256' ).update( buf ).digest( 'hex' );
const pdf = ( texto ) => Buffer.from( `%PDF-1.4\n% ${ texto }\n%%EOF\n` );

async function exigir( promesa, que ) {

	const { data, error } = await promesa;
	if ( error ) throw new Error( `${ que }: ${ error.message }` );
	return data;

}

// ─── Preparación ────────────────────────────────────────────────────────────

console.log( 'Preparando la base de datos de prueba…' );

// Mismo orden que en el SQL Editor (001 y 003 exigen que existan ya la
// administradora y el robot).
await crearUsuario( 'admin@prueba.local' );
aplicar( '001_panel.sql' );
aplicar( '002_promociones.sql' );
const robotId = await crearUsuario( 'robot@prueba.local' );
aplicar( '003_peticiones.sql' );
for ( const f of readdirSync( SQL ).filter( ( f ) => /^\d{3}_.*\.sql$/.test( f ) && f > '003' ).sort() ) aplicar( f );

// Administradora con contraseña + código del móvil.
const admin = await entrar( 'admin@prueba.local' );
const factor = await exigir( admin.auth.mfa.enroll( { factorType: 'totp' } ), 'alta del código del móvil' );
await exigir( admin.auth.mfa.challengeAndVerify( { factorId: factor.id, code: codigoTotp( factor.totp.secret ) } ), 'código del móvil' );
const adminSinMovil = await entrar( 'admin@prueba.local' );

// Dos promotoras con una promoción cada una, dadas de alta por la administradora.
const [ pA ] = await exigir( admin.from( 'promotoras' ).insert( { nombre: 'Promotora A (prueba)' } ).select( 'id' ), 'alta promotora A' );
const [ pB ] = await exigir( admin.from( 'promotoras' ).insert( { nombre: 'Promotora B (prueba)' } ).select( 'id' ), 'alta promotora B' );
await exigir( admin.from( 'promociones' ).insert( [
	{ id: 'prueba-a', promotora_id: pA.id, nombre: 'Residencial A' },
	{ id: 'prueba-a-baja', promotora_id: pA.id, nombre: 'Residencial A (se desactiva)' },
	{ id: 'prueba-b', promotora_id: pB.id, nombre: 'Residencial B' },
] ), 'alta promociones' );
const reqs = await exigir( admin.from( 'requisitos' ).insert( [
	{ promocion_id: 'prueba-a', bloque: 'Planos', elemento: 'Planta tipo' },
	{ promocion_id: 'prueba-a-baja', bloque: 'Planos', elemento: 'Planta tipo' },
	{ promocion_id: 'prueba-b', bloque: 'Planos', elemento: 'Planta tipo' },
] ).select( 'id, promocion_id' ), 'alta requisitos' );
const req = Object.fromEntries( reqs.map( ( r ) => [ r.promocion_id, r.id ] ) );

// Personas: en A, un gestor y una aprobadora; en B, una aprobadora.
const personas = [
	[ 'gestor.a@prueba.local', pA.id, 'gestor' ],
	[ 'aprobadora.a@prueba.local', pA.id, 'aprobador' ],
	[ 'aprobadora.b@prueba.local', pB.id, 'aprobador' ],
];
for ( const [ email, promotora, rol ] of personas ) {

	const id = await crearUsuario( email );
	await exigir( admin.from( 'miembros' ).insert( { user_id: id, promotora_id: promotora, nombre: email, email, rol } ), `acceso ${ email }` );

}
const gestorA = await entrar( 'gestor.a@prueba.local' );
const aprobA = await entrar( 'aprobadora.a@prueba.local' );
const aprobB = await entrar( 'aprobadora.b@prueba.local' );
const robot = await entrar( 'robot@prueba.local' );
const anonimo = nuevo();

// Cada promotora sube y registra un documento suyo.
async function subirDocumento( sb, promotora, promocion, texto ) {

	const contenido = pdf( texto );
	const ruta = `${ promotora }/${ promocion }/${ req[ promocion ] }/${ Date.now() }-planta.pdf`;
	const subida = await sb.storage.from( 'documentos' ).upload( ruta, contenido, { contentType: 'application/pdf' } );
	if ( subida.error ) return { error: subida.error, ruta };
	const { data, error } = await sb.from( 'documentos' ).insert( {
		promocion_id: promocion, requisito_id: req[ promocion ], nombre: 'planta.pdf', ruta,
		tipo: 'application/pdf', tamano: contenido.length, huella: huella( contenido ),
	} ).select( 'id, estado, version, subido_por' ).single();
	return { data, error, ruta };

}
const docB = await subirDocumento( aprobB, pB.id, 'prueba-b', 'documento de B' );
if ( docB.error ) throw new Error( `B no puede subir su documento: ${ docB.error.message }` );

// La administradora deja un plano de cada promoción pendiente de validación.
async function entregable( promocion, texto ) {

	const contenido = pdf( texto );
	const ruta = `${ promocion }/v1/plano-tipo-a.pdf`;
	await exigir( admin.storage.from( 'entregables' ).upload( ruta, contenido, { contentType: 'application/pdf' } ), `subir plano ${ promocion }` );
	return exigir( admin.from( 'entregables' ).insert( {
		promocion_id: promocion, version: 'v1', tipo: 'plano', tipologia: 'A', nombre: 'Plano tipo A', ruta, huella: huella( contenido ),
	} ).select( 'id, ruta, huella' ).single(), `registrar plano ${ promocion }` );

}
const planoA = await entregable( 'prueba-a', 'plano de A' );
const planoB = await entregable( 'prueba-b', 'plano de B' );
const planoBaja = await entregable( 'prueba-a-baja', 'plano de A (baja)' );

// ─── Comprobaciones ─────────────────────────────────────────────────────────

const resultados = [];
async function caso( grupo, texto, prueba ) {

	let ok = false, detalle = '';
	try {

		ok = await prueba();

	} catch ( e ) {

		detalle = e.message;

	}
	resultados.push( { grupo, texto, ok, detalle } );
	console.log( `${ ok ? '✔' : '✘' } ${ texto }${ detalle ? ` (${ detalle })` : '' }` );

}

const vacio = ( r ) => ! r.error && Array.isArray( r.data ) && r.data.length === 0;
const falla = ( r ) => !! r.error;
const filaDe = async ( tabla, id ) => ( await servicio.from( tabla ).select( '*' ).eq( 'id', id ).single() ).data;

const DEBE_FALLAR = 'Intentos que deben fallar';
const DEBE_FUNCIONAR = 'Uso normal que debe funcionar';

// Los 13 intentos del apartado 8 de la arquitectura.
await caso( DEBE_FALLAR, '1. A intenta ver las promociones de B', async () =>
	vacio( await gestorA.from( 'promociones' ).select( 'id' ).eq( 'promotora_id', pB.id ) )
	&& vacio( await gestorA.from( 'promotoras' ).select( 'id' ).eq( 'id', pB.id ) ) );

await caso( DEBE_FALLAR, '2. A intenta leer las fichas de documentos de B', async () =>
	vacio( await gestorA.from( 'documentos' ).select( 'id' ).eq( 'promocion_id', 'prueba-b' ) )
	&& vacio( await gestorA.from( 'requisitos' ).select( 'id' ).eq( 'promocion_id', 'prueba-b' ) )
	&& vacio( await gestorA.from( 'entregables' ).select( 'id' ).eq( 'promocion_id', 'prueba-b' ) ) );

await caso( DEBE_FALLAR, '3. A intenta listar los archivos de B', async () => {

	const docs = await gestorA.storage.from( 'documentos' ).list( `${ pB.id }/prueba-b/${ req[ 'prueba-b' ] }` );
	const entr = await gestorA.storage.from( 'entregables' ).list( 'prueba-b/v1' );
	return ( falla( docs ) || vacio( docs ) ) && ( falla( entr ) || vacio( entr ) );

} );

await caso( DEBE_FALLAR, '4. A intenta descargar un archivo de B conociendo su ruta exacta', async () =>
	falla( await gestorA.storage.from( 'documentos' ).download( docB.ruta ) )
	&& falla( await gestorA.storage.from( 'documentos' ).createSignedUrl( docB.ruta, 60 ) )
	&& falla( await gestorA.storage.from( 'entregables' ).download( planoB.ruta ) ) );

await caso( DEBE_FALLAR, '5. A intenta subir un archivo a la carpeta de B', async () =>
	falla( await gestorA.storage.from( 'documentos' ).upload( `${ pB.id }/prueba-b/${ req[ 'prueba-b' ] }/intruso.pdf`, pdf( 'intruso' ) ) )
	// …ni disfrazando la ruta con su promotora y la promoción de B
	&& falla( await gestorA.storage.from( 'documentos' ).upload( `${ pA.id }/prueba-b/${ req[ 'prueba-b' ] }/intruso.pdf`, pdf( 'intruso' ) ) )
	// …ni con su promoción y un requisito de B
	&& falla( await gestorA.storage.from( 'documentos' ).upload( `${ pA.id }/prueba-a/${ req[ 'prueba-b' ] }/intruso.pdf`, pdf( 'intruso' ) ) ) );

await caso( DEBE_FALLAR, '6. A intenta registrar un documento con la promoción de B', async () => {

	const contenido = pdf( 'de A' );
	const r1 = await gestorA.from( 'documentos' ).insert( {
		promocion_id: 'prueba-b', requisito_id: req[ 'prueba-b' ], nombre: 'x.pdf', ruta: docB.ruta + '-copia', huella: huella( contenido ),
	} );
	// …ni apuntando a un archivo de B desde su propia promoción
	const r2 = await gestorA.from( 'documentos' ).insert( {
		promocion_id: 'prueba-a', requisito_id: req[ 'prueba-a' ], nombre: 'x.pdf', ruta: docB.ruta, huella: huella( contenido ),
	} );
	return falla( r1 ) && falla( r2 );

} );

await caso( DEBE_FALLAR, '7. A intenta cambiar el estado de su propia promoción', async () => {

	await gestorA.from( 'promociones' ).update( { estado: 'publicada' } ).eq( 'id', 'prueba-a' );
	await gestorA.from( 'promociones' ).update( { activa: true, nombre: 'cambiado' } ).eq( 'id', 'prueba-a' );
	const p = await filaDe( 'promociones', 'prueba-a' );
	return p.estado === 'documentacion' && p.nombre === 'Residencial A';

} );

await caso( DEBE_FALLAR, '8. A intenta crear una promoción nueva', async () =>
	falla( await gestorA.from( 'promociones' ).insert( { id: 'prueba-intrusa', promotora_id: pA.id, nombre: 'Intrusa' } ) )
	&& falla( await gestorA.from( 'promotoras' ).insert( { nombre: 'Intrusa' } ) )
	&& falla( await gestorA.from( 'requisitos' ).insert( { promocion_id: 'prueba-a', bloque: 'x', elemento: 'x' } ) ) );

// Documento propio de A, para los casos 9 y 10.
const docA = await subirDocumento( gestorA, pA.id, 'prueba-a', 'documento de A' );

await caso( DEBE_FALLAR, '9. A intenta marcar su documento como «vigente»', async () => {

	const r = await gestorA.from( 'documentos' ).update( { estado: 'vigente' } ).eq( 'id', docA.data.id );
	// …ni colándolo ya como vigente al subirlo
	const otro = pdf( 'otro de A' );
	const ruta = `${ pA.id }/prueba-a/${ req[ 'prueba-a' ] }/vigente.pdf`;
	await gestorA.storage.from( 'documentos' ).upload( ruta, otro );
	const r2 = await gestorA.from( 'documentos' ).insert( {
		promocion_id: 'prueba-a', requisito_id: req[ 'prueba-a' ], nombre: 'v.pdf', ruta, huella: huella( otro ), estado: 'vigente',
	} );
	return ( falla( r ) || ( await filaDe( 'documentos', docA.data.id ) ).estado === 'pendiente' ) && falla( r2 );

} );

await caso( DEBE_FALLAR, '10. A intenta borrar su propio documento', async () => {

	await gestorA.from( 'documentos' ).delete().eq( 'id', docA.data.id );
	await gestorA.storage.from( 'documentos' ).remove( [ docA.ruta ] );
	// …ni sobrescribirlo
	await gestorA.storage.from( 'documentos' ).upload( docA.ruta, pdf( 'cambiado' ), { upsert: true } );
	const fila = await filaDe( 'documentos', docA.data.id );
	const archivo = await servicio.storage.from( 'documentos' ).download( docA.ruta );
	return !! fila && ! archivo.error && huella( Buffer.from( await archivo.data.arrayBuffer() ) ) === fila.huella;

} );

await caso( DEBE_FALLAR, '11. Un usuario de A sin rol de aprobador intenta aprobar un plano', async () =>
	falla( await gestorA.from( 'validaciones' ).insert( { entregable_id: planoA.id, decision: 'aprobado', confirmado: true } ) ) );

await caso( DEBE_FALLAR, '12. A intenta ver su promoción después de ser desactivada', async () => {

	await exigir( admin.from( 'promociones' ).update( { activa: false } ).eq( 'id', 'prueba-a-baja' ), 'desactivar' );
	return vacio( await gestorA.from( 'promociones' ).select( 'id' ).eq( 'id', 'prueba-a-baja' ) )
		&& vacio( await gestorA.from( 'requisitos' ).select( 'id' ).eq( 'promocion_id', 'prueba-a-baja' ) )
		&& falla( await gestorA.storage.from( 'entregables' ).download( planoBaja.ruta ) )
		&& falla( await gestorA.storage.from( 'documentos' ).upload( `${ pA.id }/prueba-a-baja/${ req[ 'prueba-a-baja' ] }/x.pdf`, pdf( 'x' ) ) );

} );

await caso( DEBE_FALLAR, '13. Alguien sin sesión intenta leer cualquier cosa', async () => {

	for ( const t of [ 'promotoras', 'promociones', 'miembros', 'requisitos', 'documentos', 'entregables', 'validaciones', 'registro', 'peticiones', 'administradores' ] ) {

		const r = await anonimo.from( t ).select( '*' ).limit( 1 );
		if ( ! falla( r ) && ! vacio( r ) ) throw new Error( `ve ${ t }` );

	}
	return falla( await anonimo.storage.from( 'documentos' ).download( docB.ruta ) )
		&& falla( await anonimo.storage.from( 'entregables' ).download( planoB.ruta ) )
		&& falla( await anonimo.storage.from( 'documentos' ).upload( `${ pB.id }/prueba-b/${ req[ 'prueba-b' ] }/anonimo.pdf`, pdf( 'x' ) ) );

} );

// Comprobaciones añadidas.
await caso( DEBE_FALLAR, '14. A intenta ver las personas con acceso de B, el registro o las peticiones', async () =>
	vacio( await gestorA.from( 'miembros' ).select( 'user_id' ).eq( 'promotora_id', pB.id ) )
	&& vacio( await gestorA.from( 'registro' ).select( 'id' ) )
	&& vacio( await gestorA.from( 'peticiones' ).select( 'id' ) )
	&& vacio( await gestorA.from( 'administradores' ).select( 'user_id' ) ) );

await caso( DEBE_FALLAR, '15. A intenta darse a sí misma el rol de aprobadora', async () => {

	const { data: { user } } = await gestorA.auth.getUser();
	await gestorA.from( 'miembros' ).update( { rol: 'aprobador' } ).eq( 'user_id', user.id );
	const r = await gestorA.from( 'miembros' ).insert( { user_id: user.id, promotora_id: pB.id, nombre: 'x', email: 'x@x', rol: 'aprobador' } );
	const fila = ( await servicio.from( 'miembros' ).select( 'rol' ).eq( 'user_id', user.id ).eq( 'promotora_id', pA.id ).single() ).data;
	return falla( r ) && fila.rol === 'gestor';

} );

await caso( DEBE_FALLAR, '16. Una aprobadora de B intenta aprobar un plano de A', async () =>
	falla( await aprobB.from( 'validaciones' ).insert( { entregable_id: planoA.id, decision: 'aprobado', confirmado: true } ) ) );

await caso( DEBE_FALLAR, '17. El robot intenta borrar, subir documentos o validar planos', async () => {

	await robot.from( 'documentos' ).delete().eq( 'id', docB.data.id );
	await robot.storage.from( 'documentos' ).remove( [ docB.ruta ] );
	await robot.from( 'promociones' ).update( { activa: false } ).eq( 'id', 'prueba-b' );
	const archivo = await servicio.storage.from( 'documentos' ).download( docB.ruta );
	return !! ( await filaDe( 'documentos', docB.data.id ) ) && ! archivo.error
		&& ( await filaDe( 'promociones', 'prueba-b' ) ).activa === true
		&& falla( await robot.storage.from( 'documentos' ).upload( `${ pB.id }/prueba-b/${ req[ 'prueba-b' ] }/robot.pdf`, pdf( 'x' ) ) )
		&& falla( await robot.from( 'documentos' ).insert( {
			promocion_id: 'prueba-b', requisito_id: req[ 'prueba-b' ], nombre: 'r.pdf', ruta: docB.ruta + '-r', huella: huella( pdf( 'r' ) ),
		} ) )
		&& falla( await robot.from( 'validaciones' ).insert( { entregable_id: planoB.id, decision: 'aprobado', confirmado: true } ) );

} );

await caso( DEBE_FALLAR, '18. La administradora sin el código del móvil no ve nada', async () =>
	vacio( await adminSinMovil.from( 'promociones' ).select( 'id' ) )
	&& vacio( await adminSinMovil.from( 'documentos' ).select( 'id' ) )
	&& falla( await adminSinMovil.from( 'promotoras' ).insert( { nombre: 'x' } ) ) );

await caso( DEBE_FALLAR, '19. Rechazar un plano sin comentario, o aprobarlo sin la casilla de confirmación', async () =>
	falla( await aprobA.from( 'validaciones' ).insert( { entregable_id: planoA.id, decision: 'rechazado', comentario: '' } ) )
	&& falla( await aprobA.from( 'validaciones' ).insert( { entregable_id: planoA.id, decision: 'aprobado', confirmado: false } ) ) );

await caso( DEBE_FALLAR, '20. Una persona con el acceso retirado intenta seguir entrando', async () => {

	const id = await crearUsuario( 'baja.a@prueba.local' );
	await exigir( admin.from( 'miembros' ).insert( { user_id: id, promotora_id: pA.id, nombre: 'Baja', email: 'baja.a@prueba.local', rol: 'aprobador' } ), 'acceso' );
	const baja = await entrar( 'baja.a@prueba.local' );
	const antes = await baja.from( 'promociones' ).select( 'id' ).eq( 'id', 'prueba-a' );
	await exigir( admin.from( 'miembros' ).update( { activo: false } ).eq( 'user_id', id ), 'retirar acceso' );
	// Misma sesión abierta: el efecto es inmediato.
	return antes.data?.length === 1 && vacio( await baja.from( 'promociones' ).select( 'id' ) )
		&& falla( await baja.storage.from( 'entregables' ).download( planoA.ruta ) );

} );

// Uso normal.
await caso( DEBE_FUNCIONAR, 'A ve sus promociones (y solo las activas)', async () => {

	const { data } = await gestorA.from( 'promociones' ).select( 'id' ).order( 'id' );
	return JSON.stringify( data.map( ( p ) => p.id ) ) === '["prueba-a"]';

} );

await caso( DEBE_FUNCIONAR, 'A ve su lista de documentos por entregar', async () =>
	( await gestorA.from( 'requisitos' ).select( 'id' ).eq( 'promocion_id', 'prueba-a' ) ).data?.length === 1 );

await caso( DEBE_FUNCIONAR, 'A sube un documento a su lista: entra como «pendiente», versión 1, a su nombre', async () => {

	const { data: { user } } = await gestorA.auth.getUser();
	return ! docA.error && docA.data.estado === 'pendiente' && docA.data.version === 1 && docA.data.subido_por === user.id;

} );

await caso( DEBE_FUNCIONAR, 'A sube una versión nueva: queda como versión 2 y remite a la anterior', async () => {

	const v2 = await subirDocumento( gestorA, pA.id, 'prueba-a', 'documento de A, v2' );
	const fila = await filaDe( 'documentos', v2.data.id );
	return fila.version === 2 && fila.reemplaza_a === docA.data.id;

} );

await caso( DEBE_FUNCIONAR, 'A descarga su documento y sus entregables', async () =>
	! falla( await gestorA.storage.from( 'documentos' ).download( docA.ruta ) )
	&& ! falla( await gestorA.storage.from( 'entregables' ).download( planoA.ruta ) )
	&& ! falla( await gestorA.storage.from( 'entregables' ).createSignedUrl( planoA.ruta, 60 ) ) );

await caso( DEBE_FUNCIONAR, 'La aprobadora de A aprueba su plano: queda la huella del archivo exacto', async () => {

	const v = await exigir( aprobA.from( 'validaciones' ).insert( {
		entregable_id: planoA.id, decision: 'aprobado', confirmado: true, comentario: 'Revisado',
	} ).select( 'huella, version, promocion_id' ).single(), 'aprobar' );
	return v.huella === planoA.huella && v.version === 'v1' && v.promocion_id === 'prueba-a';

} );

await caso( DEBE_FALLAR, '21. Cambiar o repetir una validación ya registrada', async () => {

	await aprobA.from( 'validaciones' ).update( { decision: 'rechazado' } ).eq( 'entregable_id', planoA.id );
	await aprobA.from( 'validaciones' ).delete().eq( 'entregable_id', planoA.id );
	const r = await aprobA.from( 'validaciones' ).insert( { entregable_id: planoA.id, decision: 'rechazado', comentario: 'Otra vez' } );
	const fila = ( await servicio.from( 'validaciones' ).select( 'decision' ).eq( 'entregable_id', planoA.id ) ).data;
	return falla( r ) && fila.length === 1 && fila[ 0 ].decision === 'aprobado';

} );

await caso( DEBE_FUNCIONAR, 'El robot lee los documentos y marca uno como vigente, con nota', async () => {

	const docs = await robot.from( 'documentos' ).select( 'id' );
	const archivo = await robot.storage.from( 'documentos' ).download( docB.ruta );
	await exigir( robot.from( 'documentos' ).update( { estado: 'vigente', nota: 'Correcto' } ).eq( 'id', docB.data.id ), 'marcar vigente' );
	const fila = await filaDe( 'documentos', docB.data.id );
	return docs.data.length >= 3 && ! archivo.error && fila.estado === 'vigente' && fila.revisado_por === robotId;

} );

await caso( DEBE_FUNCIONAR, 'La administradora ve todo y el registro anota subidas, revisiones y validaciones', async () => {

	const { data } = await admin.from( 'registro' ).select( 'accion' );
	const acciones = new Set( data.map( ( r ) => r.accion ) );
	const todas = ( await admin.from( 'promociones' ).select( 'id' ) ).data.length;
	return [ 'documento_subido', 'documento_vigente', 'plano_aprobado', 'acceso_dado', 'acceso_cambiado' ].every( ( a ) => acciones.has( a ) ) && todas >= 4;

} );

// ─── Resumen ────────────────────────────────────────────────────────────────

const fallidos = resultados.filter( ( r ) => ! r.ok );
const resumen = [
	'## Prueba de aislamiento entre promotoras',
	'',
	fallidos.length ? `**✘ ${ fallidos.length } comprobación(es) fallida(s).** No se debe aprobar este cambio.` : `**✔ Las ${ resultados.length } comprobaciones son correctas.**`,
	'',
	...[ DEBE_FALLAR, DEBE_FUNCIONAR ].flatMap( ( g ) => [
		`### ${ g }`, '', '| | Comprobación |', '|---|---|',
		...resultados.filter( ( r ) => r.grupo === g ).map( ( r ) => `| ${ r.ok ? '✔' : '✘' } | ${ r.texto }${ r.detalle ? ` — ${ r.detalle }` : '' } |` ),
		'',
	] ),
].join( '\n' );
if ( process.env.GITHUB_STEP_SUMMARY ) appendFileSync( process.env.GITHUB_STEP_SUMMARY, resumen + '\n' );
console.log( `\n${ fallidos.length ? `✘ ${ fallidos.length } fallida(s)` : `✔ ${ resultados.length } de ${ resultados.length } correctas` }` );
process.exit( fallidos.length ? 1 : 0 );
