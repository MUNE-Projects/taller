#!/usr/bin/env node
// Peticiones de cambios del Panel, vistas por el robot de Claude.
//
//   node herramientas/peticiones.mjs listar [--todas]
//   node herramientas/peticiones.mjs estado <id> <pendiente|en_curso|lista|descartada> [--nota "Texto"] [--enlace https://…]
//
// Credenciales: variables de entorno ROBOT_EMAIL y ROBOT_CLAVE, guardadas en la
// configuración privada del entorno de Claude. Nunca en el código, en GitHub ni
// en el chat, y este script nunca las imprime.
//
// El robot es un usuario normal de Supabase (sin clave maestra). Sus permisos
// los fijan las reglas de panel/supabase/003_peticiones.sql: leer peticiones y
// promociones, cambiar estado/nota/enlace de una petición y anotar en el
// registro. No puede borrar, crear peticiones, publicar ni cambiar reglas.

const SUPABASE_URL = 'https://iowtdenlkxjqzlpwizgb.supabase.co';
const SUPABASE_CLAVE_PUBLICA = 'sb_publishable_LLvwP-xexV-Hlz2R585IQQ_H2NfJebR';
const ESTADOS = [ 'pendiente', 'en_curso', 'lista', 'descartada' ];

const args = process.argv.slice( 2 );
const opcion = ( nombre ) => {

	const i = args.indexOf( `--${ nombre }` );
	return i >= 0 ? args[ i + 1 ] : undefined;

};
const posicionales = args.filter( ( a, i ) => ! a.startsWith( '--' ) && ! [ '--nota', '--enlace' ].includes( args[ i - 1 ] ) );

function fallo( texto ) {

	console.error( `\n✗ ${ texto }\n` );
	process.exit( 1 );

}

async function pedir( ruta, { metodo = 'GET', token, cuerpo, prefer } = {} ) {

	const r = await fetch( `${ SUPABASE_URL }${ ruta }`, {
		method: metodo,
		headers: {
			apikey: SUPABASE_CLAVE_PUBLICA,
			'Content-Type': 'application/json',
			...( token ? { Authorization: `Bearer ${ token }` } : {} ),
			...( prefer ? { Prefer: prefer } : {} ),
		},
		body: cuerpo ? JSON.stringify( cuerpo ) : undefined,
	} );
	const texto = await r.text();
	if ( ! r.ok ) fallo( `Supabase respondió ${ r.status } en ${ ruta.split( '?' )[ 0 ] }: ${ texto.slice( 0, 300 ) }` );
	return texto ? JSON.parse( texto ) : null;

}

async function entrar() {

	const email = process.env.ROBOT_EMAIL;
	const password = process.env.ROBOT_CLAVE;
	if ( ! email || ! password ) fallo( 'Faltan ROBOT_EMAIL y ROBOT_CLAVE en las variables del entorno de Claude.' );
	const sesion = await pedir( '/auth/v1/token?grant_type=password', { metodo: 'POST', cuerpo: { email, password } } );
	return sesion.access_token;

}

const anotar = ( token, accion, detalle ) => pedir( '/rest/v1/registro', { metodo: 'POST', token, cuerpo: { accion, detalle }, prefer: 'return=minimal' } );

async function listar( token ) {

	const filtro = args.includes( '--todas' ) ? '' : '&estado=in.(pendiente,en_curso)';
	const lista = await pedir( `/rest/v1/peticiones?select=id,promocion_id,version,texto,estado,nota,enlace,creada_en&order=creada_en.asc${ filtro }`, { token } );
	if ( ! lista.length ) return console.log( 'No hay peticiones pendientes.' );
	for ( const p of lista ) {

		console.log( `\n#${ p.id } · ${ p.promocion_id }${ p.version ? ` (${ p.version })` : '' } · ${ p.estado } · ${ p.creada_en.slice( 0, 16 ).replace( 'T', ' ' ) }` );
		console.log( `  ${ p.texto.replace( /\n/g, '\n  ' ) }` );
		if ( p.nota ) console.log( `  nota: ${ p.nota }` );
		if ( p.enlace ) console.log( `  enlace: ${ p.enlace }` );

	}

}

async function cambiarEstado( token, id, estado ) {

	if ( ! /^\d+$/.test( id ?? '' ) ) fallo( 'Indica el número de la petición, por ejemplo: 3' );
	if ( ! ESTADOS.includes( estado ) ) fallo( `Estado no válido. Usa: ${ ESTADOS.join( ' | ' ) }` );
	const enlace = opcion( 'enlace' );
	if ( enlace && ! /^https:\/\/\S{1,500}$/.test( enlace ) ) fallo( 'El enlace debe empezar por https://' );
	const cambios = { estado, ...( opcion( 'nota' ) ? { nota: opcion( 'nota' ) } : {} ), ...( enlace ? { enlace } : {} ) };
	const filas = await pedir( `/rest/v1/peticiones?id=eq.${ id }`, { metodo: 'PATCH', token, cuerpo: cambios, prefer: 'return=representation' } );
	if ( ! filas?.length ) fallo( `No existe la petición #${ id } (o el robot no tiene permiso)` );
	await anotar( token, 'robot actualiza una petición', { peticion: Number( id ), estado } );
	console.log( `✓ Petición #${ id } → ${ estado }` );

}

const [ orden, id, estado ] = posicionales;
const token = await entrar();
switch ( orden ) {

	case 'listar': await listar( token ); break;
	case 'estado': await cambiarEstado( token, id, estado ); break;
	default: fallo( 'Orden desconocida. Usa: listar | estado' );

}
