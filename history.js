(function(){

let myUserId = 0;
let all_my_tournaments = {};
let active_tournament_id;
let refresh_timer;
winloss = {}
let allow_refresh_completed = false
let limit_period = 1100;
let limit_prev = 0  // initially wrong, but irrelevant when filled with the same values anyway
let limit_phase = 0;
let limit_last = new Array(10).fill(-limit_period);
let limit_min_step = 10  // probably unnecessary
async function rate_limit() {
    let now = performance.now()
    let next_call = Math.max(
        now,
        limit_last[limit_phase] + limit_period,
        limit_last[limit_prev] + limit_min_step
    )
    limit_last[limit_phase] = next_call
    limit_prev = limit_phase
    limit_phase = (limit_phase+1) % limit_last.length
    let wait = next_call - now
	await new Promise(resolve => setTimeout(resolve, wait));
    return wait
}
let invalid_token = 'API token invalid'
base_url = 'https://app.matchplay.events/api/'
async function get(options) {
    const headers = new Headers();
	
    headers.set('Authorization', `Bearer ${token}`);
	headers.set('Content-Type', 'application/json');
	headers.set('Accept', 'application/json');

	const opts = {
		headers: headers,
	};

	let request_url = base_url + options.endpoint

	if (options.query) {
		request_url += '?' + new URLSearchParams(options.query).toString();
	}
	const req = new Request(request_url, opts);
	while (1) {
		await rate_limit()
		// try {
			const response = await fetch(req.clone());
			if (!response.ok) {
				if (response.status == 429) continue;  // rate limit hit. keep trying after proper wait
				if (response.status == 401) {
					log_out(invalid_token)
					throw new Error(invalid_token)
				}
				log(`${response.url} error: ${response.status}\n${await response.text()}`)
				throw new Error(`Response status: ${response.status}`);
			}
			const json = await response.json();
			return json
		// } catch (error) {
		// 	catcher(error)
		// 	break
		// }
	}
}

////////////////////// start indexedDB //////////////////////

let db;

const dbName = "history";

const request = indexedDB.open(dbName, 8);

request.onerror = (event) => {
    console.log(event)
    alert('db error')
};

request.onupgradeneeded = (event) => {
    console.log(`db needs upgrade from ${event.oldVersion} to ${event.newVersion}`)

    const db = event.target.result;

	if (event.oldVersion < 1) {
		const gameStore = db.createObjectStore("game", {keyPath: "gameId"});
		gameStore.createIndex("user1", "user1", { unique: false });
		gameStore.createIndex("user2", "user2", { unique: false });
		gameStore.createIndex("user3", "user3", { unique: false });
		gameStore.createIndex("user4", "user4", { unique: false });
	}
	if (event.oldVersion < 2) {
		db.createObjectStore("tournament", {keyPath: "tournamentId"});
	}
	if (event.oldVersion < 3) {
		db.createObjectStore("arena", {keyPath: "arenaId"});
	}
	if (event.oldVersion < 4) {
		event.target.transaction.objectStore("tournament").createIndex("status", "status", { unique: false });
	}
	if (event.oldVersion < 5) {
		event.target.transaction.objectStore("game").createIndex("arenaId", "arenaId", { unique: false });
	}
	if (event.oldVersion < 6) {
		event.target.transaction.objectStore("arena").createIndex("opdbId", "opdbId", { unique: false });
	}
	if (event.oldVersion < 7) {
		event.target.transaction.objectStore("game").createIndex("opdb", "opdb", { unique: false });
	}
	if (event.oldVersion < 8) {
		db.createObjectStore("player", {keyPath: "playerId"});
	}

	console.log('db upgrade finished')
};

success_callbacks = []
request.onsuccess = (event) => {
    db = event.target.result;
	for ([callback, args] of success_callbacks) {
		callback(...args)
	}
};
function when_db_ready(callback, ...args) {
	if (db) {
		callback(...args)
	} else {
		success_callbacks.push([callback, args])
	}
}

function put(table, obj) {
	db.transaction(table, "readwrite").objectStore(table).put(obj);
}
async function put_game(game) {
	[game.user1, game.user2, game.user3, game.user4] = game.userIds
	let arena = await get_from_db('arena', game.arenaId)
	game.opdb = arena.opdb
	put('game', game)
}

async function get_games_from_db_by_userId(userId) {
	const objectStore = db.transaction("game").objectStore("game");
	
	let result = [];
	const indexNames = ['user1', 'user2', 'user3', 'user4'];
	
	for (const key of indexNames) {
	  // Get the index for the current user key
	  const index = objectStore.index(key);
	  
	  // Wrap the getAll request in a Promise to await its result
	  const entries = await new Promise((resolve, reject) => {
		const request = index.getAll(userId);
		request.onsuccess = () => resolve(request.result);
		request.onerror = () => reject(request.error);
	  });
	  
	  // Merge the entries into the overall result array
	  result = result.concat(entries);
	}
	return result;
}

async function get_all_from_db(table) {
	const objectStore = db.transaction(table).objectStore(table);
	return await new Promise((resolve, reject) => {
		const request = objectStore.getAll();
		request.onsuccess = () => resolve(request.result);
		request.onerror = () => reject(request.error);
	});
}

async function get_from_db_by_index(table, key, id) {
	const objectStore = db.transaction(table).objectStore(table);
	const index = objectStore.index(key)
	return await new Promise((resolve, reject) => {
		const request = index.getAll(id);
		request.onsuccess = () => resolve(request.result);
		request.onerror = () => reject(request.error);
	});
}

async function get_from_db(table, id) {
	if (!id) {
		alert(`attempted to get ${table} ${id}`)
		throw(`attempted to get ${table} ${id}`)
	}
	const objectStore = db.transaction(table).objectStore(table);
	return await new Promise((resolve, reject) => {
		const request = objectStore.get(id);
		request.onsuccess = () => resolve(request.result);
		request.onerror = () => reject(request.error);
	});
}

async function clear_db() {
	for (let table of ['game', 'tournament', 'arena']) {
		db.transaction(table, 'readwrite').objectStore(table).clear();
	}
}


////////////////////// end indexedDB //////////////////////

async function get_me() {
	try {
		let response = await get({
			endpoint: 'users/profile'
		});
		myUserId = response.data.userId;
		localStorage.setItem('myUserId', myUserId)
		return;
	} catch (err) {
		catcher(err, true);
		return err.message;
	}
}

async function get_all_my_tournaments() {
	await refresh_off()
	document.getElementById('active-tournament-block').classList.add('hide');
	reset_history_tabs()
	
	document.getElementById('my-tournaments').classList.add('ready');
	all_my_tournaments = {};
	document.getElementById('my-tournaments').querySelector('div.tabs-list').innerHTML = ''
	document.getElementById('my-tournaments').querySelector('div.tabs-content').innerHTML = ''
	
	let in_progress = await load_more_tournaments(1)
	
	let manual_tournaments = get_storage_array('manual_tournaments')
	await Promise.all(manual_tournaments.map(async (t) => {
		await add_tournament_from_manual(t)
	}));
	
	if (in_progress.length == 1) {
		let status = in_progress[0][0]
		let element = in_progress[0][1]
		
		element.dispatchEvent(new Event('click'))
		activate_tab('my-tournaments', status)
	}
}

async function load_more_tournaments(page, element) {
	if (element) {
		element.remove()
	}
	let in_progress = []
	let tournament_generator = get_tournaments_paginated(myUserId, page, page)
	let result;
    while (!(result = await tournament_generator.next()).done) {
		let tournaments = result.value
		await Promise.all(tournaments.map(async (tournament) => {
			let element = await add_tournament(tournament);
			all_my_tournaments[tournament.tournamentId] = tournament
			if (tournament.status != 'completed') {
				in_progress.push([tournament.status, element])
			}
		}))
	}
	filter()
	load_more_tournaments_button(result.value);
	return in_progress
}

async function* get_tournaments_paginated(uid, from_page, to_page) {  // paginate
	let query = {
		played: uid,
		page: (from_page || 1) // increments before called
	}
	let need_more = true
	let next_page = {
		'next': null,
		'last': null,
		'message': 'load next page'
	}
	do {
		let response = await get({
			endpoint: 'tournaments',
			query: query
		});
		let tournaments = response.data
		if (query.page >= response.meta.last_page) {
			// log(`do not need more because ${query.page} >= ${response.meta.last_page}`)
			need_more = false
		}
		yield tournaments;
		query.page ++;
		next_page.next = need_more && query.page
		next_page.last = response.meta.last_page
		if (need_more && to_page && query.page > to_page) {
			return next_page
		}
	} while (need_more)
	return next_page
}
async function add_game_to_player_standing(game, uid, pid, label, box) {
	let won_game = did_i_win(game, uid)
	if (won_game !== null) {
		if (won_game == 1) {
			winloss[uid].won ++;
		} else if (won_game == -1) {
			winloss[uid].lost ++;
		}
	}
	let won = winloss[uid].won;
	let lost = winloss[uid].lost;
	let percent = won / (won+lost);
	
	winmix(label, percent)
	if (!box) {
		return
	}

	label.childNodes[1].innerHTML = ` (${won}-${lost})`

	let element = await add_player_game({
		uid: uid,
		game: game,
		won: won_game,
		order: -game.tournamentId
	})
	insertSorted(element, box, (el) => {
		return -el.dataset.id;
	});
}

function winmix(element, fraction) {
	if (isNaN(fraction)) return
	element.classList.add('winmix')
	element.style.cssText = `--winmix: ${fraction * 100}%`
}

async function get_tournament_details(tid, get_games) {

	let tournament_from_db_promise = get_from_db('tournament', tid)

	let response_promise = get({
		endpoint: `tournaments/${tid}`,
		query: {
			includePlayers: 1,
			includeArenas: 1
		}
	});

	let standings_promise
	if (get_games) {
		standings_promise = get({
			endpoint: `tournaments/${tid}/standings`
		})
	}

	let games_promise

	let tournament_from_db = await tournament_from_db_promise
	if (tournament_from_db && tournament_from_db.my_pid) {
		games_promise = get({
			endpoint: `tournaments/${tid}/games`,
			query: {player: tournament_from_db.my_pid}
		})
	}

	let tournament = (await response_promise).data;
	let players = tournament.players;
	for (player of players) {
		if (player.claimedBy == myUserId) {
			tournament.my_pid = player.playerId
		};
		put('player', player)
	}
	for (arena of tournament.arenas) {
		if (arena.opdbId) {
			arena.opdb = arena.opdbId.split('-')[0]
		}
		put('arena', arena)
	};
	let active = 0;
	let games = null;
	if (get_games) {
		if (!games_promise) {
			games_promise = get({
				endpoint: `tournaments/${tid}/games`,
				query: {player: tournament.my_pid}
			})
		}

		games = (await games_promise).data;
		let statuses = {}
		for (game of games) {
			if (!statuses[game.status]) statuses[game.status] = 0
			statuses[game.status] ++
			if (game.status !== 'completed') {
				active++
			}
			if (tournament.status == 'completed') {
				await put_game(game);
			}
		};
		log(statuses)
		
		let standings = (await standings_promise)
		for (let entry of standings) {
			if (entry.playerId == tournament.my_pid) {
				tournament.standing = 1 - (entry.position - 1) / standings.length
				break
			}
		}

		put('tournament', tournament)
		if (tournament.status == 'completed') {
			for (let box of document.querySelectorAll(`.box[data-kind="tournament"][data-id="${tid}"]`)) {
				box.classList.add('cached')
				box.classList.remove('not-cached')
				if (tournament.standing) {
					winmix(box, tournament.standing)
				}
			}
		} else {
			for (let box of document.querySelectorAll(`.box[data-kind="tournament"][data-id="${tid}"]`)) {
				box.classList.add('not-completed')
			}
			console.log(`not caching tournament because status is ${tournament.status}`)
		}
	}
	return {
		players: players,
		games: games,
		active: active,
		tournament: tournament
	};
}

modes = ['history', 'standings', 'arena']
mode = modes[(Number(localStorage.getItem('getting_standings') || '0'))]
async function switch_mode(new_mode) {
	mode = new_mode
	localStorage.setItem('getting_standings', JSON.stringify(modes.indexOf(new_mode)))
	show_mode()
}
function show_mode() {
	let header = document.getElementById('header')
	let divs = document.querySelectorAll('.modes')
	let el = document.getElementById(`${mode}-mode`)
	for (let div of divs) {
		div.classList.remove('active')
	}
	el.classList.add('active')
	
	header.textContent = el.textContent
	
	document.getElementById('standings-block').classList.toggle('hide', mode != 'standings')

	document.getElementById('active-tournament-block').classList.toggle('hide', mode != 'history')
	reset_history_tabs()
	
	document.getElementById('arenas-block').classList.toggle('hide', mode != 'arena')
	
	for (let el of document.querySelectorAll('#my-tournaments.tabs .box.active')) {
		el.classList.remove('active')
	}
	filter()
}
function minwidth(el) {
	let minwidth = el.clientWidth
	el.style.minWidth = `${minwidth}px`;
}
async function refresh_tournaments_click() {
	let button = document.getElementById('refresh-my-tournaments')
	if (button.classList.contains('wait')) return
	let text = button.querySelector('.text')
	minwidth(text)
	text.textContent = 'wait';
	minwidth(text)
	button.classList.add('wait')
	await get_all_my_tournaments();
	button.querySelector('.text').textContent = 'refresh';
	button.classList.remove('wait')
}

let wakeLock = null;
async function wakelock_on() {
	try {
		if (wakeLock && !wakeLock.released) {
			return
		}
		wakeLock = await navigator.wakeLock.request("screen");
		wakeLock.addEventListener("release", async () => {
			wakeLock = null
			await refresh_off()
		  });
	} catch (err) {
		// The Wake Lock request has failed - usually system related, such as battery.
		catcher(err);
	}
}
async function wakelock_off() {
	if (wakeLock && !wakeLock.released) {
		// log('releasing wakelock...')
		wakeLock.release().then(() => {
			// log('released')
			wakeLock = null;
		});
	} else {
		// log('wakeLock already off')
	};
}
async function refresh_on() {
	refresh_timer && clearTimeout(refresh_timer)
	refresh_timer = setTimeout(refresh_tournament_timer, 5000);
	let refresh_button = document.getElementById('refresh-active-tournament');
	refresh_button.classList.add('timed');
	let text = refresh_button.querySelector('.text')
	minwidth(text)
	text.textContent = 'live';
	minwidth(text)
	await wakelock_on();
}
async function refresh_off(will_refresh) {
	refresh_timer && clearTimeout(refresh_timer);
	refresh_timer = null;
	let refresh_button = document.getElementById('refresh-active-tournament');
	refresh_button.classList.remove('timed');
	let text = refresh_button.querySelector('.text')
	minwidth(text)
	if (will_refresh) {
		text.textContent = 'wait';
	} else {
		text.textContent = 'refresh';
		await wakelock_off();
	}
	minwidth(text)
}
async function refresh_tournament_click() {
	if (refresh_timer) {
		await refresh_off();
	} else {
		await refresh_tournament_timer();
	}
}
async function refresh_tournament_timer() {
	try {
		await refresh_off(true);
		if (await do_refresh_tournament()) {
			await refresh_on();
		} else {
			await refresh_off();
		}
	} catch (err) {
		refresh_off();
		catcher(err)
	}
}
async function do_refresh_tournament() {
	let result = await tournament_history(active_tournament_id, true);
	if (result.changes) {
		await flash_screen();
		return false;
	} else {
		if (result.status == 'completed' && !allow_refresh_completed) {
			return false;
		} else {
			return true;
		}
	};
}
async function flash_screen() {
	for (let x=0; x<10;x++) {
		document.body.classList.add('flash')
		await new Promise(resolve => setTimeout(resolve, 200));
		document.body.classList.remove('flash')
		await new Promise(resolve => setTimeout(resolve, 200));
	}
}
async function click_tournament(id) {
	if (mode == 'history') {
		await tournament_history(id)
	} else {
		await tournament_toggled()
	}
}
function filterfocus() {
	document.getElementById('filters').classList.add('selected')
	document.getElementById('filter').focus()

}
function filter(save, value) {
	if (value) {
		document.getElementById('filter').value = value
	} else {
		value = document.getElementById('filter').value
	}
	for (el of document.querySelectorAll('#my-tournaments.tabs div.tabs-content .box:not(.fake)')) {
		el.classList.remove('hide')
		el.classList.remove('active')
	}
	if (value) {
		const regex = new RegExp(value, 'gmi')
		for (el of document.querySelectorAll('#my-tournaments.tabs div.tabs-content .box:not(.fake)')) {
			let name = el.textContent
			regex.lastIndex = 0;
			if (regex.test(name)) {
				el.classList.remove('hide')
				if (mode != 'history') {
					el.classList.add('active')
				}
			} else {
				el.classList.add('hide')
			}
		}
	}
	if (save && value) {
		update_storage_array('filters', (filters) => {
			filters = filters.slice(0, 10)
			if (!remove_from_array(filters, value)) {
				prepend_filter(value)
			}
			filters.push(value)
			return filters
		})
		document.getElementById('filter').scrollIntoView({block: 'center'})
	}
	tournament_toggled()
}
function delete_filter(x) {
	let elem = x.parentElement
	let value = elem.children[0].textContent

	update_storage_array('filters', (filters) => {
		elem.remove()
		return remove_from_array(filters, value) && filters
	})
}
function get_storage_array(name) {
	let raw = localStorage.getItem(name) || '[]'
	let x = JSON.parse(raw)
	if (!Array.isArray(x)) {
		alert(`strange data in local storage for ${name}: ${raw}`)
		x = []
	}
	return x
}
async function update_storage_array_async(name, update_function) {
	let array = get_storage_array(name)
	let result = await update_function(array)
	if (result) {
		localStorage.setItem(name, JSON.stringify(result))
	}
}
function update_storage_array(name, update_function) {
	let array = get_storage_array(name)
	let result = update_function(array)
	if (result) {
		localStorage.setItem(name, JSON.stringify(result))
	}
}
function remove_from_array(array, element) {
	const index = array.indexOf(element);
	if (index > -1) { // only splice array when item is found
		array.splice(index, 1); // 2nd parameter means remove one item only
		return true
	}
}
async function tournament_toggled() {
	let n = document.querySelectorAll('#my-tournaments.tabs .box.active:not(.fake)').length
	document.getElementById('arenas-title').textContent = `Arenas in ${n} tournaments`
	document.getElementById('standings-title').textContent = `Standings across ${n} tournaments`
	document.getElementById('load-standings').classList.toggle('hide', n==0)
	document.getElementById('standings-table').classList.add('hide')
	document.getElementById('load-arenas').classList.toggle('hide', n==0)
	document.getElementById('arenas-table').classList.add('hide')
}

function load_standings_settings() {
	let settings = JSON.parse(localStorage.getItem('standings-settings') || '{}')

	if (settings.minscore) document.getElementById('score-min').value = settings.minscore
	if (settings.maxscore) document.getElementById('score-max').value = settings.maxscore
	if (settings.combine_names !== undefined) document.getElementById('combine-names').checked = settings.combine_names
	if (settings.custom_column_header) document.getElementById('custom-column-header').value = settings.custom_column_header

	if (settings.show_points !== undefined) document.getElementById('show-points').checked = settings.show_points
	if (settings.show_mtgs !== undefined) document.getElementById('show-mtgs').checked = settings.show_mtgs
	if (settings.show_win !== undefined) document.getElementById('show-win').checked = settings.show_win
	if (settings.show_avg_pts !== undefined) document.getElementById('show-avg-pts').checked = settings.show_avg_pts
	if (settings.show_avg_place !== undefined) document.getElementById('show-avg-place').checked = settings.show_avg_place
	if (settings.show_finals !== undefined) document.getElementById('show-finals').checked = settings.show_finals

	if (settings.b_attendance) document.getElementById('b-attendance').value = settings.b_attendance
	if (settings.a_attendance) document.getElementById('a-attendance').value = settings.a_attendance
	if (settings.a_size) document.getElementById('a-size').value = settings.a_size
	if (settings.bonus_1) document.getElementById('bonus-1').value = settings.bonus_1
	if (settings.bonus_2) document.getElementById('bonus-2').value = settings.bonus_2
	if (settings.bonus_3) document.getElementById('bonus-3').value = settings.bonus_3
	if (settings.bonus_players) document.getElementById('bonus-players').value = settings.bonus_players.join(',')
	if (settings.a_restricted) document.getElementById('a-restricted').value = settings.a_restricted.join(',')
	return settings
}
function get_standings_settings() {
	let settings = {}
	
	settings.minscore = Number(document.getElementById('score-min').value)
	settings.maxscore = Number(document.getElementById('score-max').value)
	settings.combine_names = document.getElementById('combine-names').checked
	settings.custom_column_header = document.getElementById('custom-column-header').value

	settings.show_points = document.getElementById('show-points').checked
	settings.show_mtgs = document.getElementById('show-mtgs').checked
	settings.show_win = document.getElementById('show-win').checked
	settings.show_avg_pts = document.getElementById('show-avg-pts').checked
	settings.show_avg_place = document.getElementById('show-avg-place').checked
	settings.show_finals = document.getElementById('show-finals').checked

	settings.b_attendance = Number(document.getElementById('b-attendance').value)
	settings.a_attendance = Number(document.getElementById('a-attendance').value)
	settings.a_size = Number(document.getElementById('a-size').value)
	settings.bonus_1 = Number(document.getElementById('bonus-1').value)
	settings.bonus_2 = Number(document.getElementById('bonus-2').value)
	settings.bonus_3 = Number(document.getElementById('bonus-3').value)
	settings.bonus_players = (document.getElementById('bonus-players').value).replaceAll(',', ' ').split(' ')
	settings.a_restricted = (document.getElementById('a-restricted').value).replaceAll(',', ' ').split(' ')
	
	localStorage.setItem('standings-settings', JSON.stringify(settings))
	return settings
}
let loaded_standings = {}
let standings_settings
async function selected_tournaments() {
	let elements = document.querySelectorAll('#my-tournaments.tabs .box.active:not(.fake)')
	cache_all_tournaments(elements)
	return [...elements]
}
async function load_standings() {
	document.getElementById('load-standings').classList.add('hide')
	document.getElementById('standings-table').classList.add('hide')

	loaded_standings.overall_standings = {}
	loaded_standings.games_played = {}
	loaded_standings.player_standings_by_player = {}
	loaded_standings.standings_tournaments = []
	loaded_standings.id_by_name = {}

	standings_settings = get_standings_settings()

	await Promise.all((await selected_tournaments()).map(async (el) => {
		let tid = Number(el.dataset.id)
		let tournament = await get_from_db('tournament', tid)
		loaded_standings.standings_tournaments.push(tournament)
		let standings = await get({
			endpoint: `tournaments/${tid}/standings`
		})
		for (let entry of standings) {
			let id = entry.playerId
			if (standings_settings.combine_names) {
				let player = await get_from_db('player', id)
				alternate_id = loaded_standings.id_by_name[player.name.toLowerCase()]
				if (alternate_id) {
					id = alternate_id
				} else {
					loaded_standings.id_by_name[player.name.toLowerCase()] = id
				}
			}
			if (!loaded_standings.player_standings_by_player[id]) {
				loaded_standings.player_standings_by_player[id] = {}
				loaded_standings.games_played[id] = 0
			}
			if (loaded_standings.player_standings_by_player[id][tid]) {
				alert(`multiple entries for ${id} in ${tournament.name}`)
			}
			loaded_standings.player_standings_by_player[id][tid] = entry.position
			loaded_standings.games_played[id] += 1
		}

	}))
	
	loaded_standings.standings_tournaments.sort((a,b) => {
		if (a.startUtc < b.startUtc) {
			return -1
		} else if (a.startUtc < b.startUtc) {
			return 1
		} else {
			return 0
		}
	})
	let table = await show_standings_table(true)
	table.scrollIntoView()
}
let a_divisions = []
let b_divisions = []
async function show_standings_table(settings_already_loaded) {
	if (!settings_already_loaded) {
		standings_settings = get_standings_settings()
	}

	let bonus_met = function(i, pid) {
		let n = 0
		for (let x of standings_settings.bonus_players) {
			if (x == pid) n = 1
		}
		return [(
			n +
			Number(i >= standings_settings.bonus_1) +
			Number(i >= standings_settings.bonus_2) +
			Number(i >= standings_settings.bonus_3)
		), n]
	}
	let is_restricted = function(pid) {
		for (let x of standings_settings.a_restricted) {
			if (x == pid) return true
		}
	}
	let calculate_points = function(position) {
		return Math.max(standings_settings.maxscore+1-position, standings_settings.minscore)
	}
	let get_custom_column_header = function(name) {
		if (!standings_settings.custom_column_header) {
			return
		}
		try {
			let regex = new RegExp(standings_settings.custom_column_header, 'gmi')
			let result = regex.exec(name);
			if (result) {
				return result.groups.abbr
			}
		} catch (err) {
			return
		}
	}
	let overall_standings = {}
	let overall_place = {}
	for (let id of Object.keys(loaded_standings.player_standings_by_player)) {
		overall_standings[id] = 0
		overall_place[id] = 0
		for (let position of Object.values(loaded_standings.player_standings_by_player[id])) {
			overall_standings[id] += calculate_points(position)
			overall_place[id] += position
		}
	}

	let table = document.getElementById('standings-table')
	table.classList.remove('hide')

	let td

	let headrow = table.querySelector('thead tr')
	headrow.innerHTML = ''

	th = document.createElement('th')
	th.textContent = 'Pos'
	headrow.append(th)
	
	th = document.createElement('th')
	th.textContent = 'Player'
	th.classList.add('has-text-align-left')
	th.dataset.align = 'left'
	headrow.append(th)
	
	if (standings_settings.show_points) {
		th = document.createElement('th')
		th.textContent = 'Points'
		headrow.append(th)
	}

	if (standings_settings.show_mtgs) {
		th = document.createElement('th')
		th.textContent = 'Mtgs'
		headrow.append(th)
	}
	
	if (standings_settings.show_finals) {
		th = document.createElement('th')
		th.textContent = 'Div'
		th.classList.add('has-text-align-left')
		th.dataset.align = 'left'
		headrow.append(th)
		
		th = document.createElement('th')
		th.textContent = 'Bonus'
		headrow.append(th)
	}

	if (standings_settings.show_win) {
		th = document.createElement('th')
		th.textContent = 'Win%'
		headrow.append(th)
	}
	if (standings_settings.show_avg_pts) {
		th = document.createElement('th')
		th.textContent = 'Avg Pts'
		headrow.append(th)
	}
	if (standings_settings.show_avg_place) {
		th = document.createElement('th')
		th.textContent = 'Avg Place'
		headrow.append(th)
	}
	
	for (tournament of loaded_standings.standings_tournaments) {
		th = document.createElement('th')
		let custom_column_header = get_custom_column_header(tournament.name)
		// th.classList.add('wk')
		if (custom_column_header) {
			th.textContent = custom_column_header
		} else {
			th.classList.add('vertical')
			let span = document.createElement('span')
			th.appendChild(span)
			span.textContent = tournament.name
		}
		headrow.append(th)
	}

	let tbody = table.querySelector('tbody')
	tbody.innerHTML = ''

	const overall_standings_entries = sorted_dictionary(overall_standings, true);
	let i = 1
	let tie_rank = 1
	let tie_score = null
	added_restriction = false
	added_bonus = false
	console.log(loaded_standings)
	for (let [id, score] of overall_standings_entries) {
		id = Number(id)
		let tr = document.createElement('tr')

		if (score !== tie_score) {
			tie_rank = i
			tie_score = score
		}
		td = document.createElement('td')
		td.textContent = tie_rank
		tr.append(td)
		
		td = document.createElement('td')
		let player = await get_from_db('player', id)
		td.textContent = player.name
		// td.classList.add('text')
		td.classList.add('has-text-align-left')
		td.dataset.align = 'left'
		tr.append(td)

		if (standings_settings.show_points) {
			td = document.createElement('td')
			td.textContent = score
			tr.append(td)
		}

		if (standings_settings.show_mtgs) {	
			td = document.createElement('td')
			td.innerHTML = loaded_standings.games_played[id] + '&nbsp;'
			tr.append(td)
		}
		
		if (standings_settings.show_finals) {
			td = document.createElement('td')
			// td.classList.add('division', 'text')
			td.classList.add('has-text-align-left')
			td.dataset.align = 'left'	
			let restricted = is_restricted(id)
			if (restricted) added_restriction = true
			if (tie_rank <= standings_settings.a_size && loaded_standings.games_played[id] >= standings_settings.a_attendance) {
				a_divisions.push(player.name)
				if (restricted) {
					td.innerHTML = 'A*'
				} else {
					td.innerHTML = 'A&nbsp;&nbsp;'
				}
			} else if (restricted) {
				td.innerHTML = '*'
			} else if (loaded_standings.games_played[id] >= standings_settings.b_attendance) {
				b_divisions.push(player.name)
				td.innerHTML = 'B'
			} else {
				td.innerHTML = '&mdash;'
			}
			td.addEventListener('click', handler(toggle_restricted, id, player.name))
			tr.append(td)

			td = document.createElement('td')
			let [bonus, player_earned] = bonus_met(loaded_standings.games_played[id], id)
			if (bonus) {
				td.innerHTML = ('+' + bonus)
				if (player_earned) {
					td.innerHTML += '†'
					added_bonus = true
				} else {
					td.innerHTML += '&nbsp;&nbsp;'
				}
			} else {
				td.innerHTML = '&mdash;'
			}
			td.addEventListener('click', handler(toggle_bonus, id, player.name))
			tr.append(td)
		}

		if (standings_settings.show_win) {
			td = document.createElement('td')
			td.textContent = (score / loaded_standings.games_played[id] / standings_settings.maxscore).toFixed(2)
			tr.append(td)
		}
		if (standings_settings.show_avg_pts) {
			td = document.createElement('td')
			td.textContent = (score / loaded_standings.games_played[id]).toFixed(0)
			tr.append(td)
		}
		if (standings_settings.show_avg_place) {
			td = document.createElement('td')
			td.textContent = (overall_place[id] / loaded_standings.games_played[id]).toFixed(1)
			tr.append(td)
		}

		for (let tournament of loaded_standings.standings_tournaments) {
			td = document.createElement('td')
			// td.classList.add('wk')
			let val = calculate_points(loaded_standings.player_standings_by_player[id][tournament.tournamentId])
			if (val) {
				td.innerHTML = val
			} else {
				td.innerHTML = '&mdash;'
			}
			tr.append(td)
		}

		tbody.append(tr)
		i++
	}
	table.querySelector('figure figcaption')?.remove()
	let captions = []
	if (added_restriction) {
		captions.push('* Restricted to A Division')
	}
	if (added_bonus) {
		captions.push('† Extra bonus added')
	}
	if (captions.length) {
		let caption = document.createElement('figcaption')
		caption.classList.add('wp-element-caption')
		caption.innerHTML = captions.join('<br />')
		table.querySelector('figure').append(caption)
	}
	return table
}
async function standings_toggle(input_id, add_prompt, remove_prompt, id, name) {
	let el = document.getElementById(input_id)
	let vals = el.value.replaceAll(',', ' ').split(' ')
	let index = vals.indexOf(String(id))
	if (index > -1) {
		if (confirm(remove_prompt)) {
			vals.splice(index, 1)
			el.value = vals.join(',')
			await show_standings_table()
		}
	} else {
		if (confirm(add_prompt)) {
			vals.push(id)
			el.value = vals.join(',')
			await show_standings_table()
		}
	}
}
async function toggle_restricted(id, name) {
	await standings_toggle(
		'a-restricted',
		`Restrict ${name} to A Division?`,
		`Remove A Division restriction for ${name}?`,
		id
	)
}
async function toggle_bonus(id, name) {
	await standings_toggle(
		'bonus-players',
		`Add extra bonus for ${name}?`,
		`Remove extra bonus for ${name}?`,
		id
	)
}
async function load_arenas() {
	let tournament_ids = (await selected_tournaments()).map((el) => Number(el.dataset.id))
	if (!tournament_ids.length) {
		return
	}

	document.getElementById('load-arenas').classList.add('hide')
	let table = document.getElementById('arenas-table')
	table.classList.remove('hide')
	table.innerHTML = ''
	let group = tab('arenas-table', 'Arenas')

	let arena_occurrences = {}
	let arena_names = {}
	let opdbIds = {}

	await Promise.all(tournament_ids.map(async (tid) => {
		let tournament = await get_from_db('tournament', tid)
		let tournament_arena_names = {}
		let arenas
		if (tournament.arenas) {
			arenas = tournament.arenas
		} else {
			arenas = (await get({
				endpoint: `tournaments/${tid}`,
				query: {'includeArenas': 1}
			})).data.arenas
		}
		for (let arena of arenas) {
			if (arena.opdbId) {
				let opdb = arena.opdbId.split('-')[0]
				if (!opdbIds[opdb]) opdbIds[opdb] = {}
				opdbIds[opdb][arena.opdbId] = 1
				tournament_arena_names[opdb] = arena
			}
		}
		for (let [opdb, arena] of Object.entries(tournament_arena_names)) {
			if (!arena_occurrences[opdb]) arena_occurrences[opdb] = [0, null]
			arena_occurrences[opdb][0] ++;
			arena_occurrences[opdb][1] = arena
			arena_occurrences[opdb][2] = tournament
			arena_names[opdb] = arena.name
		}
	}))

	let full_history = document.getElementById('full-arena-history').checked
	const arenas_entries = sorted_dictionary(arena_occurrences, true, 0);
	for (let [opdb, [occurrences, an_arena, tournament]] of arenas_entries) {
		let box = document.createElement('div')
		box.classList.add('box', 'arenas')
		group.box.append(box)

		let wins = 0
		let losses = 0
		let num_games = 0

		for (let game of await get_from_db_by_index('game', 'opdb', opdb)) {
			if (full_history || tournament_ids.includes(game.tournamentId)) {
				num_games ++
				let winloss = rank(game)
				wins += Math.floor(winloss.maxplace - winloss.place)
				losses += Math.floor(winloss.place)
			}
		}
		let titlediv = document.createElement('div')
		titlediv.textContent = arena_names[opdb]
		titlediv.title = opdb
		titlediv.append(matchplay_link(`tournaments/${tournament.tournamentId}/arenas/${an_arena.arenaId}`))

		let played = document.createElement('div')
		if (num_games) {
			played.textContent = `played ${num_games} game${num_games > 1 ? "s" : ""}: ${wins} — ${losses}`
		} else {
			played.innerHTML = 'not played'
		}

		let leftdiv = document.createElement('div')
		leftdiv.append(titlediv)
		leftdiv.append(spacer())
		leftdiv.append(played)
		box.append(leftdiv)

		box.append(spacer());

		let occ = document.createElement('div')
		occ.classList.add('occurrences')
		occ.textContent = occurrences
		box.append(occ)

		winmix(box, wins / (wins+losses))
	}

}
function sorted_dictionary(dictionary, descending, index) {
	let sign = descending ? -1 : 1
	return Object.entries(dictionary).sort(([keyA, valueA], [keyB, valueB]) => {
		if (index !== undefined) {
			valueA = valueA[index]
			valueB = valueB[index]
		}
		return sign * (valueA - valueB) || keyA.localeCompare(keyB)
	});
}
async function tournament_history(tid, refreshing) {
	let get_players
	tid = Number(tid)
	active_tournament_id = tid
	let active_tournament_box = document.getElementById('active-tournament')
	if (refreshing) {
		get_players = false
	} else {
		get_players = true
		reset_history_tabs()
		active_tournament_box.innerHTML = '';
		for (el of document.querySelectorAll('#frenzy-countdown span')) el.textContent = ''
	}

	log('getting games from tournament')
	let result = (await get_tournament_details(tid, true));
	let tournament = result.tournament

	await get_frenzy_position(tournament)

	if (refreshing) {
		log(`in refresh, changes: ${result.active}`)
		if (!result.active) {
			return {
				changes: 0,
				status: tournament.status
			}
		}
	}

	let active_games = result.games

	document.getElementById('active-tournament-block').classList.remove('hide')
	let title_h2 = document.getElementById('active-tournament-title');
	title_h2.classList.remove(...title_h2.classList);
	title_h2.classList.add(tournament.status);
	title_h2.innerHTML = '';
	title_h2.append(await title('tournament', tid, 'span'));
	title_h2.append(matchplay_link(`tournaments/${tid}`))
	
	let in_progress = []
	await Promise.all(active_games.map(async (game) => {
		let element = await add_tournament_game(game);
		if (game.status != 'completed') in_progress.push([game.status, element]);
	}))
	if (get_players) {
		await Promise.all(result.players.map(async (player) => {
			let uid = player.claimedBy;
			let pid = player.playerId
			await add_player_button(uid, pid);
		}))
		count_tab(tab('active-tournament', 'players'))
		await Promise.all(tournament.arenas.map(async (arena) => {
			await add_arena_button(arena)
		}))
		count_tab(tab('active-tournament', 'arenas'))
	}
	if (in_progress.length == 1 && mode == 'history') {
		let status = in_progress[0][0]
		let element = in_progress[0][1]
		activate_tab('active-tournament', status)
		element.dispatchEvent(new Event('click'))
	}

	return {
		changes: in_progress.length,
		status: tournament.status
	}
}
function matchplay_link(url_tail) {
	let url = 'https://app.matchplay.events/' + url_tail
	let a = document.createElement('a')
	a.classList.add('matchplay-link')
	a.href = url
	a.target = '_blank'
	return a
}
function arc(queue_pos, queue_size) {
	let factor
	if (queue_pos === null) {
		factor = 1
	} else {
		factor = (queue_size - queue_pos - 0.5) / (queue_size)
	}
	let b = Math.PI * 2 * factor / 2
	let c = Math.PI * 2 * factor
	let centerx = 30
	let centery = 30
	let radius = 20
	let ax = centerx
	let ay = centery - radius
	let bx = centerx + radius*Math.sin(b)
	let by = centery - radius*Math.cos(b)
	let cx = centerx + radius*Math.sin(c)
	let cy = centery - radius*Math.cos(c)
	let long = 0  // (factor > .5) ? 1 : 0
	let svg = `<svg width="60" height="60" viewBox="0 0 60 60"><path d="M ${ax} ${ay} A ${radius} ${radius} 0 ${long} 1 ${bx} ${by} A ${radius} ${radius} 0 ${long} 1 ${cx} ${cy}"/></svg>`
	return svg
}
async function get_frenzy_position(tournament) {
	let div = document.getElementById('frenzy-countdown');
	for (el of div.querySelectorAll('span')) el.textContent = ''
	
	if (tournament.type != 'frenzy') {
		return;
	}

	let frenzy = await get({
		endpoint: `tournaments/${tournament.tournamentId}/frenzy`,
	})
	let my_pid = tournament.my_pid;
	let queue_pos = null;
	let queue_size = frenzy.queue.length;
	for (const [i, queue] of frenzy.queue.entries()) {
		if (queue.playerId == my_pid) {
			queue_pos = i;
		}
	}
	// if (queue_size && queue_pos !== null) {
		queue_progress = (queue_size - queue_pos) / queue_size;
		let svg = arc(queue_pos, queue_size);
		let msg
		if (queue_pos) {
			msg = `${queue_pos} ahead of you in queue of ${queue_size}`
		} else if (queue_pos === null) {
			msg = `you are not in the queue of ${queue_size}`
		} else {
			msg = `you're next in the queue of ${queue_size}`
		}
		div.querySelector('.text').prepend(msg);
		div.querySelector('.pie').innerHTML = svg;
	// } else {
	// 	for (el of div.querySelectorAll('span')) el.textContent = ''
	// }
}
function reset_history_tabs() {
	let history = document.getElementById('selected-history')
	history.innerHTML = '<div id="player-histories-tabs" class="tabs" data-tabgroup="player-histories-tabs"></div>'
}
async function compare_game(gameId) {
	let game = await get_from_db('game', gameId)
	let uids = game.userIds;
	let pids = game.playerIds;
	reset_history_tabs()
	let elem = await game_element(game, true, false)
	let header = document.createElement('div')
	header.classList.add('boxgroup', 'shadow')
	fakefill(header)
	header.append(elem)
	document.getElementById('player-histories-tabs').before(header)
	let arena = await get_from_db('arena', game.arenaId)
	let namestr = await get_name('arena', arena.arenaId)
	let group = tab('player-histories-tabs', namestr, arena.opdb)
	group.label.classList.add('arena-name')
	await load_arena_history(arena, group.label, group.box)
	count_tab(group)
	await load_active_players_history(uids, pids);
}
async function compare_arena(arena) {
	reset_history_tabs()
	let header = document.createElement('h3')
	header.append(await title('arena', arena.arenaId, 'span'))
	header.append(matchplay_link(`tournaments/${active_tournament_id}/arenas/${arena.arenaId}`))
	document.getElementById('player-histories-tabs').before(header)
	let namestr = await get_name('arena', arena.arenaId)
	let group = tab('player-histories-tabs', namestr, arena.opdb)
	await load_arena_history(arena, group.label, group.box)
	count_tab(group)
}
async function load_arena_history(arena, label, box) {
	let games = await get_from_db_by_index('game', 'opdb', arena.opdb)
	let wins = 0
	let losses = 0
	await Promise.all(games.map(async (game) => {
		if (box) {
			insertSorted(await game_element(game, true, true), box, (el) => -el.dataset.id)
		}
		let winloss = rank(game)
		wins += Math.floor(winloss.maxplace - winloss.place)
		losses += Math.floor(winloss.place)
	}))
	winmix(label, wins / (wins+losses))
}
async function compare_player(uid, pid) {
	reset_history_tabs()
	let header = document.createElement('h3')
	header.append(await title('user', uid, 'span', 'player', pid))
	if (uid) {
		header.append(matchplay_link(`users/${uid}`))
	}
	document.getElementById('player-histories-tabs').before(header)
	await load_active_players_history([uid], [pid])
}
async function load_active_players_history(uids, pids) {
	await Promise.all(uids.map(async (uid, index) => {
		let pid = pids && pids[index]
		if (uid != myUserId) {
			let namestr = await get_name('user', uid, 'player', pid)
			let group = tab('player-histories-tabs', namestr, uid || pid)
			await load_games_to_player_standing(uid, pid, group.label, group.box)
		}
	}))
	// document.querySelector('#selected-history .tabs-list').scrollIntoView({block: 'center'});
}
async function load_games_to_player_standing(uid, pid, label, box) {
	uid = Number(uid)
	winloss[uid] = {won: 0, lost: 0}
	let games = (await get_games_from_db_by_userId(uid))
	await Promise.all(games.map(async (game) => {
		await add_game_to_player_standing(game, uid, pid, label, box)
	}))
	if (!uid && box) {
		let note = document.createElement('div')
		note.textContent = 'Player unclaimed; history unavailable'
		note.classList.add('box')
		box.append(note)
	} else if (!games.length && box) {
		let note = document.createElement('div')
		note.classList.add('box')
		note.textContent = 'No games played together'
		box.append(note)
	}
}
function rankspan(string) {
	let rankdiv = document.createElement('span')
	rankdiv.classList.add('rank')
	rankdiv.innerHTML = string
	return rankdiv
}
function rank(game, uid, pid) {
	if (uid === undefined) {
		uid = myUserId
	}
	if (uid !== null) {
		pid = game.playerIds[game.userIds.indexOf(uid)]
	}
	let index = game.playerIds.indexOf(pid)

	let place = null
	let string = ''
	let maxplace = game.userIds.length - 1

	let result = game.resultPositions
	// real results are best, but not for fair strikes
	if (result && result.length && !result.includes(null)) {
		place = result.indexOf(pid)
		string = ['1<sup>st</sup>', '2<sup>nd</sup>', '3<sup>rd</sup>', '4<sup>th</sup>'][place]
	}

	// suggested results even works with fair strikes
	else if (game.suggestions && game.suggestions.length == 1) {
		place = game.suggestions[0].results.indexOf(pid)
		string = ['1st', '2nd', '3rd', '4th'][place]
	}

	// if there are no suggestions and it's fair strikes, can't differentiate ties
	else if (game.resultPoints) {
		let my_points = game.resultPoints[index]
		let point_choices = [...game.resultPoints]
		point_choices.sort()
		let initial_rank = point_choices.indexOf(my_points)
		let occurrences = 0;
		for (pt of point_choices) {
			if (pt == my_points) {
				occurrences ++;
			}
		}
		place = maxplace - (initial_rank + (occurrences-1)/2)
		if (place == 0) {
			string = '&ndash;'
		} else if (place == maxplace) {
			string = '2&times;'
		} else {
			string = '&times;'
		}
	}
	

	let fraction = (game.userIds.length - 1 - place)/(game.userIds.length - 1)
	return {
		place: place,
		fraction: fraction,
		maxplace: maxplace,
		string: string
	}
}
function did_i_win(game, uid) {
	let me = rank(game, myUserId).place
	let other = rank(game, uid).place
	if (me === null || other === null) return null
	if (me == other) {
		return 0
	} else if (me < other) {
		return 1
	} else {
		return -1
	}
}
token_promises = []
async function token_needed(message) {
	document.getElementById('token-entry').classList.remove('hide');
	if (message) document.getElementById('token-message').textContent = message;
	return new Promise(function (resolve, reject) {
		token_promises.push([resolve, reject])
	});
}
async function main(message) {
	await log_in(message)
	await get_all_my_tournaments()
	show_mode()
}

async function log_in(message) {
	document.getElementById('main').classList.add('hide');
	document.getElementById('options').classList.add('hide')

	message = message || 'Log in by providing your Match Play API token'
	while (await (async function() {
		token = localStorage.getItem('token');
		if (token) {
			myUserId = Number(localStorage.getItem('myUserId'));
			if (myUserId) {
				return false
			} else {
				message = await get_me()
				if (!message) {
					return false
				}
			}
		}
		return true
	})()) {
		await token_needed(message)
	}
	document.getElementById('token-entry').classList.add('hide');
	document.getElementById('main').classList.remove('hide')
	document.getElementById('options').classList.remove('hide')
}

async function log_out(message) {
	document.getElementById('options').classList.remove('shown')
	token = ''
	localStorage.removeItem('token')
	localStorage.removeItem('myUserId')
	clear_db()
	await main(message)
}
async function clear_cache() {
	db.close()
	indexedDB.deleteDatabase(dbName)
	window.location.reload()
}

////////////////////////////////////////////////////////////////

let ready = (callback) => {
	if (document.readyState != 'loading') {
		callback();
	} else {
		document.addEventListener('DOMCOntentLoaded', callback);
	}
}
ready(async () => {
	document.getElementById('refresh-my-tournaments').addEventListener('click', handler(refresh_tournaments_click));
	document.getElementById('refresh-active-tournament').addEventListener('click', handler(refresh_tournament_click));
	for (const el of document.querySelectorAll('#options .items div')) el.addEventListener('click', function () {
		this.parentElement.parentElement.classList.remove('shown')
	})
	document.querySelector('#options .button').addEventListener('click', function () {
		this.parentElement.classList.toggle('shown')
	});
	
	document.getElementById('log-out').addEventListener('click', handler(log_out, 'logged out'))
	document.getElementById('clear-cache').addEventListener('click', handler(clear_cache))
	document.getElementById('token-form').addEventListener('submit', async function (event) {
		try {
			event.preventDefault();
			let tinput = document.getElementById('token')
			token = tinput.value;
			tinput.value = '';
			localStorage.setItem('token', token);
			localStorage.removeItem('myUserId');
			for (promise of token_promises) promise[0]()
			token_promises = []
		} catch (err) {
			catcher(err)
			for (promise of token_promises) promise[1]()
			token_promises = []
		}
	});
	document.getElementById('standings-mode').addEventListener('click', handler(switch_mode, 'standings'))
	document.getElementById('history-mode').addEventListener('click', handler(switch_mode, 'history'))
	document.getElementById('arena-mode').addEventListener('click', handler(switch_mode, 'arena'))
	document.getElementById('load-standings').addEventListener('click', handler(load_standings))
	document.getElementById('load-arenas').addEventListener('click', handler(load_arenas))
	document.getElementById('filter').addEventListener('input', handler(filter))
	document.getElementById('filter').addEventListener('change', handler(filter, true))
	document.getElementById('filters').addEventListener('click', handler(filterfocus))
	document.getElementById('cache-box').addEventListener('click', handler(cache_all_tournaments))
	document.getElementById('manual-tournament').addEventListener('click', handler(add_manual_tournament, true))
	document.getElementById('load-next-page').addEventListener('click', handler(load_more_tournaments_click, true))
	document.getElementById('full-arena-history').addEventListener('change', handler(load_arenas))
	document.getElementById('standings-settings').addEventListener('click', handler(function () {
		document.getElementById('standings-settings-table').classList.toggle('hide')
	}))
	for (let el of document.querySelectorAll('#standings-settings-table input.need-reload')) {
		el.addEventListener('change', handler(tournament_toggled))
	}
	for (let el of document.querySelectorAll('#standings-settings-table input:not(.need-reload)')) {
		el.addEventListener('change', handler(show_standings_table))
	}
	document.getElementById('copy-table').addEventListener('click', handler(function () {
		navigator.clipboard && navigator.clipboard.writeText(document.querySelector('#standings-table>figure').innerText.trim()).catch(function () { });
	}))
	document.getElementById('copy-html').addEventListener('click', handler(function () {
		navigator.clipboard && navigator.clipboard.writeText(document.querySelector('#standings-table>figure').outerHTML.trim()).catch(function () { });
	}))
	document.getElementById('copy-a-division').addEventListener('click', handler(function () {
		navigator.clipboard && navigator.clipboard.writeText(a_divisions.join('\n')).catch(function () { });
	}))
	document.getElementById('copy-b-division').addEventListener('click', handler(function () {
		navigator.clipboard && navigator.clipboard.writeText(b_divisions.join('\n')).catch(function () { });
	}))

	load_filters_history()
	load_standings_settings()

	when_db_ready(main)
});

async function cache_all_tournaments(boxes) {
	if (boxes === undefined) {
		boxes = [...document.querySelectorAll('.box[data-kind="tournament"][data-id]:not(.cached)')]
	}
	let tids = []
	for (let box of boxes) {
		if (box.classList.contains('cached')) continue;
		let tid
		if (tid = Number(box.dataset.id)) {
			tids.push(tid)
		}
	}
	document.getElementById('cache-box').classList.add('selected')
	await Promise.all(tids.map(async (tid) => {
		await get_tournament_details(tid, true)
	}))
	document.getElementById('cache-box').classList.remove('selected')
	document.getElementById('cache-box').classList.add('hide')
}

function load_filters_history() {
	for (let x of document.querySelectorAll('#filters>div')) {
		x.remove()
	}
	for (let f of get_storage_array('filters')) {
		prepend_filter(f)
	}
}
function prepend_filter(f) {
	let fspan = document.createElement('span')
	fspan.textContent = f
	fspan.addEventListener('click', handler(filter, true, f))
	let delete_button = document.createElement('span')
	delete_button.textContent = '×'
	delete_button.addEventListener('click', handler(delete_filter, 'this'))
	let fdiv = document.createElement('div')
	fdiv.append(fspan)
	fdiv.append(delete_button)
	document.getElementById('filter').insertAdjacentElement('afterend', fdiv)
}
function tabhandler(callback, ...args) {
	let handle = async function () {
		try {
			refresh_off()
			let tabs = this.closest('.tabs')
			if (mode == 'history') {
				for (child of tabs.querySelectorAll('.active')) child.classList.remove('active')
				this.classList.add('active')
			} else {
				this.classList.toggle('active')
			}
			await callback(...args)
		} catch (err) {
			this.classList.remove('active')
			await catcher(err)
		}
	}
	return handle
}
function handler(callback, ...args) {
	let handle = async function (event) {
		try {
			if (args[0] == 'event') {
				args[0] = event
			}
			if (args[0] == 'this') {
				args[0] = this
			}
			await callback(...args)
		} catch (err) {
			await catcher(err)
		}
	}
	return handle
}
function insertSorted(element, parent, sortvalue_function) {
	let added = false;
	if (!sortvalue_function) {
		sortvalue_function = (el) => {
			return el.textContent.toLowerCase()
		}
	}
	let etext = sortvalue_function(element);
	for (el of parent.children) {
		if (sortvalue_function(el) > etext) {
			parent.insertBefore(element, el);
			added = true;
			return false;
		}
	};
	if(!added) parent.append(element);
}

async function add_arena_button(arena) {
	let box = await title('arena', arena.arenaId);
	box.classList.add('box', 'click');
	box.addEventListener('click', tabhandler(compare_arena, arena))
	insertSorted(box, tab('active-tournament', 'arenas').box);
	await load_arena_history(arena, box)
}
async function add_player_button(uid, pid) {
	let button = await title('user', uid, 'div', 'player', pid);
	button.classList.add('box', 'click');
	button.addEventListener('click', tabhandler(compare_player, uid, pid))
	insertSorted(button, tab('active-tournament', 'players').box);
	load_games_to_player_standing(uid, pid, button)
}
async function get_name(kind, id, fallback_kind, fallback_id) {
	let str;
	if (!id) {
		if (fallback_kind) {
			str = get_name(fallback_kind, fallback_id)
		} else if (kind == 'user') {
			str = '[unclaimed player]'
		} else {
			str = `[${id} ${kind}]`
		}
	} else if (kind == 'tournament' || kind == 'arena' || kind == 'player') {
		let obj = await get_from_db(kind, id)
		if (obj) {
			str = obj.name
		} else {
			str = kind + id;
			console.log('missing', str)
		}
	} else {
		if (fallback_kind) {
			str = get_name(fallback_kind, fallback_id)
		} else {
			str = kind + id;
			console.log(`missing ${str}, fallback was ${fallback_kind}${fallback_id}`)
		}
	}
	return str
}
async function title(kind, id, element_type, fallback_kind, fallback_id) {
	let element = notitle(kind, id, element_type);
	element.classList.add(kind+'-name');
	element.classList.add('title');
	let str = await get_name(kind, id, fallback_kind, fallback_id)
	if (id == myUserId) {
		element.classList.add('me')
	}
	element.textContent = str;  // `${name} (${kind} ${id})`);
	return element;
}
function notitle(kind, id, element_type) {
	let element = document.createElement(element_type || 'div')
	element.dataset.kind = kind
	element.dataset.id = id
	return element;
}
function spacer() {
	let el = document.createElement('div');
	el.classList.add('spacer');
	return el
}
async function add_player_game(options) {
	let box = await game_element(options.game, false, true, options.won);
	box.style.order = options.order;
	return box
}
async function add_tournament_game(game) {
	let box = await game_element(game, true, false);
	box.classList.add('click')
	box.addEventListener('click', tabhandler(compare_game, game.gameId));
	let group = tab('active-tournament', game.status)
	insertSorted(box, group.box, (el) => {
		return -el.dataset.id
	})
	count_tab(group)
	return box;
}
async function game_element(game, inc_players, inc_tournament, won) {
	let box = notitle('game', game.gameId, 'span');
	box.classList.add('box');

	let leftdiv = document.createElement('div')
	leftdiv.classList.add('side')
	box.append(leftdiv)
	let tit = await title('arena', game.arenaId);
	leftdiv.append(tit)

	if (inc_players) {
		leftdiv.append(spacer())
		let plist = document.createElement('div');
		plist.classList.add('players');
		leftdiv.append(plist);
		game.userIds.forEach(async (uid, index) => {
			let pid = game.playerIds[index]
			let li = document.createElement('div');
			li.append(rankspan(rank(game, uid, pid).string))
			li.append(await title('user', uid, 'span', 'player', pid));  // not actually async
			plist.append(li);
		})
	}
	if (inc_tournament) {
		leftdiv.append(spacer());
		leftdiv.append(await title('tournament', game.tournamentId));
	}

	let wordrank;
	if (won === undefined) {
		let win_rank = rank(game, myUserId);
		if (win_rank.place !== null) {
			winmix(box, win_rank.fraction)
			wordrank = win_rank.string
		} else {
			wordrank = stringify(win_rank)
		}
	} else if (won === null) {
		wordrank = '?'
	} else if (won == 1) {
		wordrank = 'won'
		winmix(box, 1)
		box.classList.add('vs')
	} else if (won == -1) {
		wordrank = 'lost'
		winmix(box, 0)
		box.classList.add('vs')
	} else {
		wordrank = 'tie'
		winmix(box, 0.5)
		box.classList.add('vs')
	}
	box.append(spacer())
	let rightdiv = document.createElement('div')
	rightdiv.classList.add('side')
	rightdiv.append(matchplay_link(`tournaments/${game.tournamentId}/matches/${game.gameId}`))
	rightdiv.append(spacer())
	rightdiv.append(rankspan(wordrank))
	box.append(rightdiv)

	return box;
}
async function add_tournament(tournament, manual) {
	let tid = tournament.tournamentId
	let box = await title('tournament', tid)
	box.textContent = tournament.name
	box.classList.add('box', 'click');
	if (manual) {
		let del = document.createElement('div')
		del.textContent = '×'
		del.title = 'remove manually added tournament'
		box.append(del)
		del.classList.add('delete-tournament')
		del.addEventListener('click', handler(remove_manual_tournament, 'event', tid))
	}
	box.addEventListener('click', tabhandler(click_tournament, tid));
	let cached_tourney = (await get_from_db('tournament', tid));
	if (cached_tourney) {
		box.classList.add('cached')
		if (cached_tourney.standing) {
			winmix(box, cached_tourney.standing)
		}
	} else {
		box.classList.add('not-cached')
		document.getElementById('cache-box').classList.remove('hide')
	}
	let group = tab('my-tournaments', tournament.status)
	insertSorted(box, group.box, (el) => {
		return -el.dataset.id;
	});
	count_tab(group)
	return box
}
function remove_manual_tournament(event, tid) {
	event.stopPropagation()
	document.querySelector(`.box[data-kind="tournament"][data-id="${tid}"]`).remove()
	update_storage_array('manual_tournaments', (manuals) => {
		return remove_from_array(manuals, tid) && manuals
	})
}
async function add_manual_tournament() {
	let response = prompt('Tournament ID (found in URL)')
	if (!response) return
	let tid = Number(response)
	update_storage_array_async('manual_tournaments', async (manuals) => {
		if (manuals.indexOf(tid) == -1) {
			await add_tournament_from_manual(tid)
			manuals.push(tid)
			filter()
			return manuals
		}
	})
}
async function add_tournament_from_manual(tid) {
	/*
	tournament by id, from entering the tournanent id manually
	*/
	if (all_my_tournaments[tid]) return
	let details = await get_tournament_details(tid, false)
	await add_tournament(details.tournament, true)
}
function load_more_tournaments_click() {
	let next_page = document.getElementById('load-next-page').dataset.next
	load_more_tournaments(next_page)
}
function load_more_tournaments_button(value) {
	let button = document.getElementById('load-next-page')
	button.dataset.next = value.next
	if (value.next) {
		button.textContent = `load page ${value.next} of ${value.last}`
		button.classList.remove('hide')
	} else {
		button.classList.add('hide')
		return
	}
}
function count_tab(group) {
	let c = 0
	for (let child of group.box.childNodes) {
		if (!child.classList.contains('fake')) c++
	}
	group.label.childNodes[1].textContent = ` (${c})`
}
function activate_tab(tabgroup, status) {
	let group = tab(tabgroup, status)
	for (let node of group.label.parentNode.childNodes) {
		node.classList.remove('selected')
	}
	group.label.classList.add('selected')
	for (let node of group.box.parentNode.childNodes) {
		node.classList.remove('selected')
	}
	group.box.classList.add('selected')
	group.label.scrollIntoView({block: 'center', inline: 'center'})
}
function tab(parent, text, identifier) {
	parent = document.getElementById(parent)
	let labels
	let boxes
	if (!parent.children.length) {
		labels = document.createElement('div')
		labels.classList.add('tabs-list')
		parent.append(labels)
		boxes = document.createElement('div')
		boxes.classList.add('tabs-content')
		parent.append(boxes)
	} else {
		labels = parent.children[0]
		boxes = parent.children[1]
	}
	if (identifier === undefined) identifier = text
	let tabgroup = parent.dataset.tabgroup
	let boxgroup = boxes.querySelector(`.boxgroup.${tabgroup}-${identifier}`)
	let label = labels.querySelector(`#${tabgroup}-${identifier}`)

	if (!boxgroup) {
		let id = `${tabgroup}-${identifier}`

		label = document.createElement('label')
		label.setAttribute('id', id)
		label.textContent = text
		let count = document.createElement('span')
		label.append(count)
		label.addEventListener('click', handler(activate_tab, tabgroup, identifier))
		labels.append(label)

		boxgroup = document.createElement('div')
		boxgroup.classList.add('clickables', 'boxgroup', id)
		boxgroup.dataset.inputid = id
		fakefill(boxgroup)
		boxes.append(boxgroup)
		
		if (labels.childNodes.length == 1)
			activate_tab(tabgroup, identifier)
	}

	return {
		box: boxgroup,
		label: label,
		parent: parent,
		boxes: boxes,
		labels: labels
	}
}
function fakefill(element) {
	for (i=0;i<10;i++) {
		let new_el = document.createElement('div');
		new_el.classList.add('fake', 'invisible', 'box');
		element.append(new_el);
	}
	return element;
}

})()