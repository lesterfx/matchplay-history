let myUserId = 0;
let all_my_tournaments = {};
let my_lowest_tournament;
let active_players = {};
let my_pid_by_organizer = {};
let active_tournament_id;
let refresh_timer;
let all_data = {
	user: {},
	arena: {},
	tournament: {},
	game: {},
	player: {}
}
let allow_refresh_completed = false  // also change css
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
async function get(options) {
    const headers = new Headers();
	
    headers.set('Authorization', `Bearer ${token}`);
	headers.set('Content-Type', 'application/json');
	headers.set('Accept', 'application/json');

	const opts = {
		headers: headers,
	};

	base_url = 'https://app.matchplay.events/api/'
	let request_url = base_url + options.endpoint

	if (options.query) {
		request_url += '?' + new URLSearchParams(options.query).toString();
	}
	const req = new Request(request_url, opts);
	while (1) {
		await rate_limit()
		try {
			const response = await fetch(req.clone());
			if (!response.ok) {
				if (response.status == 429) continue;  // rate limit hit. keep trying after proper wait
				if (response.status == 401) throw new Error(invalid_token)
				log(`${response.url} error: ${response.status}\n${await response.text()}`)
				throw new Error(`Response status: ${response.status}`);
			}
			const json = await response.json();
			// log(json)
			return json
		} catch (error) {
			catcher(error)
			break
		}
	}
}

////////////////////// indexedDB //////////////////////

let db;

const dbName = "history";

const request = indexedDB.open(dbName, 1);

request.onerror = (event) => {
    console.log(event)
    alert('db error')
};

request.onupgradeneeded = (event) => {
    console.log('db needs upgrade')
    const db = event.target.result;
    const objectStore = db.createObjectStore("game", {keyPath: "gameId"});
    objectStore.createIndex("user1", "user1", { unique: false });
    objectStore.createIndex("user2", "user2", { unique: false });
    objectStore.createIndex("user3", "user3", { unique: false });
    objectStore.createIndex("user4", "user4", { unique: false });
    console.log('db upgrade finished')
};

request.onsuccess = (event) => {
    console.log('db open success')
    db = event.target.result;
};

function add_game_to_db(game) {
	[game.user1, game.user2, game.user3, game.user4] = game.userIds
	console.log(game)
	const gameObjectStore = db
		.transaction("game", "readwrite")
		.objectStore("game");
	gameObjectStore.add(game);  // or .put, if it's already there
}
function add_tournament_to_db(tournament) {

}

////////////////////// indexedDB //////////////////////

async function get_me() {
	try {
		let response = await get({
			endpoint: 'users/profile'
		});
		myUserId = response.data.userId;
		return;
	} catch (err) {
		catcher(err, true);
		return err.message;
	}
}

async function get_all_my_tournaments() {
	await refresh_off()
	document.getElementById('active-tournament-block').classList.add('hide');
	document.getElementById('selected-game').innerHTML = '';
	document.getElementById('player-histories').innerHTML = '';

	document.getElementById('my-tournaments').classList.add('ready');
	all_my_tournaments = {};
	my_lowest_tournament = undefined
	document.getElementById('my-tournaments').innerHTML = ''
	
	let in_progress = await load_more_tournaments(1)

	let manual_tournaments = get_storage_array('manual_tournaments')
	await Promise.all(manual_tournaments.map(async (t) => {
		await add_tournament_by_id(t)
	}));
	manual_tournament_button();

	if (in_progress.length == 1) {
		let status = in_progress[0][0]
		let element = in_progress[0][1]
		
		element.dispatchEvent(new Event('click'))
		activate_tab(my_tournaments_tab(status))
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
		for (let tournament of tournaments) {
			let element = add_tournament(tournament);
			all_my_tournaments[tournament.tournamentId] = tournament
			if (tournament.status != 'completed') in_progress.push([tournament.status, element])
		}
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
		let data = response.data
		for (tournament of data) {
			save_data('tournament', tournament);
			if (uid != myUserId && tournament.tournamentId <= my_lowest_tournament) {
				need_more = false
				// log(`do not need more because ${tournament.tournamentId} <= ${my_lowest_tournament}`)
			}
		};
		if (query.page >= response.meta.last_page) {
			// log(`do not need more because ${query.page} >= ${response.meta.last_page}`)
			need_more = false
		}
		yield data;
		query.page ++;
		next_page.next = need_more && query.page
		next_page.last = response.meta.last_page
		if (need_more && to_page && query.page > to_page) {
			console.log(`to_page && query.page > to_page, query.page=${query.page}`)
			return next_page
		}
	} while (need_more)
	console.log(`done with get_tournaments_paginated, need_more=${need_more}, query.page=${query.page}`)
	return next_page
}
async function get_tournaments(uid) {  // paginate
	let response = await get({
		endpoint: 'tournaments',
		query: {played: uid}
	});
	for (tournament of response.data) {
		save_data('tournament', tournament);
	};
	return response.data;
}
async function get_games_from_tournaments(tournaments) {
	let tids = [];
	for (tid in tournaments) {  // parallelize
		tids.push(tid);
	}
	const promises = tids.map(get_and_populate_games_from_tournament);
	await Promise.all(promises);
}
function add_game_to_player_standing(game, uid) {
	let won = did_i_win(game, uid)
	if (won !== null) {
		if (won) {
			winloss[uid].won ++;
		} else {
			winloss[uid].lost ++;
		}
		update_player_standing(uid)
		update_player_standing(uid, document.getElementById('selected-game'))
	}
	add_player_game({
		uid: uid,
		game: game,
		won: won,
		order: -tid
	})
}
async function get_and_populate_games_from_tournament(tid) {
	let tournament = all_data.tournament[tid]
	let tournament_games = (await get_games_from_tournament(tournament)).games;
	for (uid in active_players) {
		for (game of tournament_games) {
			add_game_to_player_standing(game, uid)
		}
	};
	let listnodes = document.querySelectorAll(`#player-histories div.player-history div.merged-tournaments`);
	for (listnode of listnodes) {
		for (let node of listnode.querySelectorAll(`[data-kind="tournament"][data-id="${tid}"]`)) node.remove();
		if (listnode.innerHTML == '') listnode.remove()
	}
}
async function get_games_from_tournament(tournament, add_players) {
	let tid = tournament.tournamentId;
	let pid;
	if (my_pid_by_organizer[tid] && !add_players) {
		pid = my_pid_by_organizer[tid];
	} else {
		let result = await get_tournament_details(tid);

		pid = result.pid
		my_pid_by_organizer[tid] = pid;

		if (add_players) {
			all_data.user = {};
			for (player of result.players) {
				let uid = player.claimedBy;
				if (uid == myUserId) {
					continue;
				};
				if (!all_data.user[uid]) {
					all_data.user[uid] = player;
					add_player_button(uid);
				}
			};
		}
	
	};
	let response = await get({
		endpoint: `tournaments/${tid}/games`,
		query: {player: pid}
	});
	let games = response.data
	let changes = 0;
	for (game of games) {
		changes += save_data('game', game);
		if (tournament.status == 'completed') {
			add_game_to_db(game);
		}
	};
	if (tournament.status == 'completed') {
		add_tournament_to_db(tournament)
	}
	return {games: games, changes: changes};
}
async function get_tournament_details(tid) {
	let response = await get({
		endpoint: `tournaments/${tid}`,
		query: {
			includePlayers: 1,
			includeArenas: 1
		}
	});
	let tournament_details = response.data;
	save_data('tournament', response.data)
	let pid;
	let players = tournament_details.players;
	for (player of players) {
		if (player.claimedBy == myUserId) {
			pid = player.playerId;
			break;
		};
	}
	for (arena of tournament_details.arenas) {
		save_data('arena', arena);
	};
	return {pid: pid, players: players};
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
		div.classList.remove('hide')
	}
	el.classList.add('hide')
	
	header.textContent = el.textContent
	document.getElementById('standings-block').classList.toggle('hide', mode != 'standings')
	document.getElementById('active-tournament-block').classList.toggle('hide', mode != 'history')
	document.getElementById('selected-history').classList.toggle('hide', mode != 'history')
	document.getElementById('arenas-block').classList.toggle('hide', mode != 'arena')
	for (let el of document.querySelectorAll('#my-tournaments.tabs .box.active')) el.classList.remove('active')
	filter()
}
async function refresh_tournaments_click() {
	await get_all_my_tournaments();
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
	refresh_button.style.minWidth = `${refresh_button.offsetWidth}px`;
	refresh_button.classList.add('timed');
	refresh_button.querySelector('.text').textContent = 'live';
	await wakelock_on();
}
async function refresh_off(will_refresh) {
	refresh_timer && clearTimeout(refresh_timer);
	refresh_timer = null;
	let refresh_button = document.getElementById('refresh-active-tournament');
	refresh_button.style.minWidth = `${refresh_button.offsetWidth}px`;
	refresh_button.classList.remove('timed');
	if (will_refresh) {
		refresh_button.querySelector('.text').textContent = 'wait';
	} else {
		refresh_button.querySelector('.text').textContent = 'refresh';
		await wakelock_off();
	}
}
async function refresh_tournament_click() {
	if (refresh_timer) {
		log('turn off refresh')
		await refresh_off();
	} else {
		log('turn on refresh')
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
	let status = all_data.tournament[active_tournament_id].status;
	let changes = await tournament_history();
	if (changes) {
		await flash_screen();
		return false;
	} else {
		if (status == 'completed' && !allow_refresh_completed) {
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
		return await tournament_history(id)
	} else {
		return await tournament_toggled()
	}
}
function filter(save, value) {
	if (value) {
		document.getElementById('filter').value = value
	} else {
		value = document.getElementById('filter').value
	}
	for (el of document.querySelectorAll('#my-tournaments.tabs .box:not(.fake)')) {
		el.classList.remove('hide')
		el.classList.remove('active')
	}
	if (value) {
		const regex = new RegExp(value, 'gmi')
		for (el of document.querySelectorAll('#my-tournaments.tabs .box:not(.fake)')) {
			let tid = el.dataset.id
			let tournament = all_data.tournament[tid]
			regex.lastIndex = 0;
			if (regex.test(tournament.name)) {
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
function selected_tournaments() {
	return document.querySelectorAll('#my-tournaments.tabs .box.active:not(.fake)')
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

	for (el of selected_tournaments()) {
		let tid = el.dataset.id
		let tournament = all_data.tournament[tid]
		loaded_standings.standings_tournaments.push(tournament)
		let standings = await get({
			endpoint: `tournaments/${tid}/standings`
		})
		let need_players = false
		for (let entry of standings) {
				let pid = entry.playerId
				if (!all_data.player[pid]) {
					need_players = true
				}
		}
		if (need_players) {
			for (let p of (await get({
				endpoint: `tournaments/${tid}`,
				query: {'includePlayers': 1}
			})).data.players) {
				all_data.player[p.playerId] = p.name
			}
		}
		for (let entry of standings) {
			let id = entry.playerId
			if (standings_settings.combine_names) {
				alternate_id = loaded_standings.id_by_name[all_data.player[entry.playerId].toLowerCase()]
				if (alternate_id) {
					id = alternate_id
				} else {
					loaded_standings.id_by_name[all_data.player[entry.playerId].toLowerCase()] = id
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
	}
	
	loaded_standings.standings_tournaments.sort((a,b) => {
		if (a.startUtc < b.startUtc) {
			return -1
		} else if (a.startUtc < b.startUtc) {
			return 1
		} else {
			return 0
		}
	})
	show_standings_table(true).scrollIntoView()
}
let a_divisions = []
let b_divisions = []
function show_standings_table(settings_already_loaded) {
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
	for (let [id, score] of overall_standings_entries) {
		let tr = document.createElement('tr')

		if (score !== tie_score) {
			tie_rank = i
			tie_score = score
		}
		td = document.createElement('td')
		td.textContent = tie_rank
		tr.append(td)
		
		td = document.createElement('td')
		let name = all_data.player[id]
		td.textContent = name
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
				a_divisions.push(name)
				if (restricted) {
					td.innerHTML = 'A*'
				} else {
					td.innerHTML = 'A&nbsp;&nbsp;'
				}
			} else if (restricted) {
				td.innerHTML = '*'
			} else if (loaded_standings.games_played[id] >= standings_settings.b_attendance) {
				b_divisions.push(name)
				td.innerHTML = 'B'
			}
			td.addEventListener('click', handler(toggle_restricted, id, name))
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
			}
			td.addEventListener('click', handler(toggle_bonus, id, name))
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
function standings_toggle(input_id, add_prompt, remove_prompt, id, name) {
	let el = document.getElementById(input_id)
	let vals = el.value.replaceAll(',', ' ').split(' ')
	let index = vals.indexOf(id)
	if (index > -1) {
		if (confirm(remove_prompt)) {
			vals.splice(index, 1)
			el.value = vals.join(',')
			show_standings_table()
		}
	} else {
		if (confirm(add_prompt)) {
			vals.push(id)
			el.value = vals.join(',')
			show_standings_table()
		}
	}
}
function toggle_restricted(id, name) {
	standings_toggle(
		'a-restricted',
		`Restrict ${name} to A Division?`,
		`Remove A Division restriction for ${name}?`,
		id
	)
}
function toggle_bonus(id, name) {
	standings_toggle(
		'bonus-players',
		`Add extra bonus for ${name}?`,
		`Remove extra bonus for ${name}?`,
		id
	)
}
async function load_arenas() {
	document.getElementById('load-arenas').classList.add('hide')
	document.getElementById('arenas-table').classList.add('hide')

	let arena_occurrences = {}
	for (el of selected_tournaments()) {
		let tid = el.dataset.id;
		let tournament = all_data.tournament[tid];
		// log(tournament.name)
		let arena_names = []
		let arenas
		if (tournament.arenas) {
			arenas = tournament.arenas
		} else {
			arenas = (await get({
				endpoint: `tournaments/${tid}`,
				query: {'includeArenas': 1}
			})).data.arenas
		}
		for (arena of arenas) {
			arena_names.push(arena.name.split(' (')[0])
		}
		arena_names = [...new Set(arena_names)]  // sometimes an arena was in the same tournament twice
		arena_names.sort((a, b) => a.localeCompare(b));
		for (name of arena_names) {
			// if (arena.status == 'inactive') continue
			if (!arena_occurrences[name]) arena_occurrences[name] = 0
			arena_occurrences[name] ++;
		}
		// log('\n--\n')
	}
	const arenas_entries = sorted_dictionary(arena_occurrences, true);
	document.getElementById('arenas-table').classList.remove('hide')
	let tbody = document.getElementById('arenas-tbody')
	tbody.textContent = ''
	for ([arena, occurrences] of arenas_entries) {
		let tr = document.createElement('tr')
		let td
		td = document.createElement('td')
		td.textContent = arena
		tr.appendChild(td)
		
		td = document.createElement('td')
		td.textContent = occurrences
		tr.appendChild(td)

		tbody.appendChild(tr)
	}
}
function sorted_dictionary(dictionary, descending) {
	let sign = descending ? -1 : 1
	return Object.entries(dictionary).sort(([keyA, valueA], [keyB, valueB]) => 
		sign * (valueA - valueB) || keyA.localeCompare(keyB)
	);
}
async function tournament_history(id) {  // formerly get_other
	let refresh_players
	if (id) {
		active_tournament_id = id
		refresh_players = true
		document.getElementById('active-tournament').innerHTML = '';
		for (el of document.querySelectorAll('#frenzy-countdown span')) el.textContent = ''
	} else {
		// refreshing
		refresh_players = false
	}
	let tournament = all_data.tournament[active_tournament_id];

	active_players = {};

	await get_frenzy_position(tournament)

	let result = (await get_games_from_tournament(tournament, refresh_players));
	if (!refresh_players && !result.changes) return;

	let active_games = result.games
	active_games.reverse();

	document.getElementById('player-histories').innerHTML = ''
	document.getElementById('active-tournament-block').classList.remove('hide')
	let title_h2 = document.getElementById('active-tournament-title');
	title_h2.classList.remove(...title_h2.classList);
	title_h2.classList.add(tournament.status);
	title_h2.innerHTML = '';
	title_h2.append(title('tournament', tournament.tournamentId, 'span'));

	let in_progress = []
	for (game of active_games) {
		let element = add_active_game(game);
		if (game.status != 'completed') in_progress.push([game.status, element]);
	};
	document.getElementById('active-tournament-title').scrollIntoView();
	if (in_progress.length == 1 && mode == 'history') {
		let status = in_progress[0][0]
		let element = in_progress[0][1]
		element.dispatchEvent(new Event('click'))
		activate_tab(active_tournament_tab(status))
	}
	return in_progress.length;
}
function arc(queue_pos, queue_size) {
	let factor = (queue_size - queue_pos - 0.5) / (queue_size)
	let a = Math.PI * 2 * factor
	let centerx = 30
	let centery = 30
	let radius = 20
	let ax = centerx
	let ay = centery - radius
	let bx = centerx + radius*Math.sin(a)
	let by = centery - radius*Math.cos(a)
	let long = (factor > .5) ? 1 : 0
	let svg = `<svg width="60" height="60" viewBox="0 0 60 60"><path d="M ${ax} ${ay} A ${radius} ${radius} 0 ${long} 1 ${bx} ${by}"/></svg>`
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
	let my_pid = my_pid_by_organizer[tournament.tournamentId];
	let queue_pos = null;
	let queue_size = frenzy.queue.length;
	for (const [i, queue] of frenzy.queue.entries()) {
		if (queue.playerId == my_pid) {
			queue_pos = i;
		}
	}
	let queue_progress;
	if (queue_size && queue_pos !== null) {
		queue_progress = (queue_size - queue_pos) / queue_size;
		let svg = arc(queue_pos, queue_size);
		let msg
		if (queue_pos) {
			msg = `${queue_pos} ahead of you in queue of ${queue_size}`
		} else {
			msg = "You're on deck!"
		}
		div.querySelector('.text').prepend(msg);
		div.querySelector('.pie').innerHTML = svg;
	} else {
		for (el of div.querySelectorAll('span')) el.textContent = ''
	}
}
async function compare_players_from_game(id) {
	active_players = {};
	let game = all_data.game[id]
	document.getElementById('player-histories').innerHTML = '';  // or don't?
	let selected = document.getElementById('selected-game');
	fakefill(selected)
	selected.append(game_element(game, true, false));
	winloss = {}
	let uids = game.userIds;
	for (const uid of uids) {
		if (uid == myUserId) continue;
		if (add_active_player(uid)) {
			active_players[uid] = 1;
		}
	};
	await load_active_players_history();
}
async function compare_player(id) {
	document.getElementById('player-histories').innerHTML = ''
	let selected = document.getElementById('selected-game');
	fakefill(selected)
	winloss = {}
	active_players = {}
	active_players[id] = true
	if (add_active_player(id)) {
		await load_active_players_history()
	}
}
async function load_active_players_history() {  // formerly merge_tournaments
	let tournaments
	document.getElementById('selected-history').scrollIntoView();
	let merged_tournaments = {};
	for (uid in active_players) {
		for await (tournaments of get_tournaments_paginated(uid, 1, 1)) {
			for (let tournament of tournaments) {
				let tid = tournament.tournamentId
				if (all_my_tournaments[tid]) {
					add_player_tournament(uid, tid)
					merged_tournaments[tid] = true
				}
			};
		};
	};
	await get_games_from_tournaments(merged_tournaments);
}
function rank(game, uid) {
	let playerId
	for (let i=0; i<game.userIds.length; i++) {
		let userId = game.userIds[i]
		if (userId == uid) {
			playerId = game.playerIds[i]
			break
		}
	}

	let result = game.resultPositions
	if (!result || !result.length || result.includes(null)) {
		if (game.suggestions && game.suggestions.length) {
			result = game.suggestions[0].results
		} else {
			log('game has no resultPositions or suggestions')
			log(game)
			return null
		}
	}
	return result.indexOf(playerId)
}
function did_i_win(game, uid) {
	let me = rank(game, myUserId)
	let other = rank(game, uid)
	if (me === null || other === null) return null
	return me < other
}
function rankiness(game) {
	return {
		place: rank(game, myUserId),
		maxplace: game.userIds.length - 1
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
async function main() {
	document.getElementById('main').classList.add('hide');
	document.getElementById('options').classList.add('hide')

	let message = 'Log in by providing your Match Play API token'
	while (await (async function() {
		token = localStorage.getItem('token');
		if (token) {
			message = await get_me()
			if (!message) {
				return false
			}
		}
		return true
	})()) {
		await token_needed(message)
	}
	document.getElementById('token-entry').classList.add('hide');
	document.getElementById('main').classList.remove('hide')
	document.getElementById('options').classList.remove('hide')

	await get_all_my_tournaments();

	show_mode()
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
		try {
			this.parentElement.classList.toggle('shown')
		} catch (err) {
			catcher(err)
		}
	});
	// document.getElementById('custom').addEventListener('click', function () {
	// 	try {
	// 		document.getElementById('custom-section').classList.remove('hide')
	// 	} catch (err) {
	// 		catcher(err)
	// 	}
	// })
	
	document.getElementById('run-custom').addEventListener('click', async function () {
		try {
			log(await get({
				endpoint: document.getElementById('custom-endpoint').value
			}))
		} catch (err) {
			catcher(err)
		}
	})

	// document.getElementById('notify').addEventListener('click', function () {
	// 	try {
	// 		notifyMe()
	// 	} catch (err) {
	// 		catcher(err)
	// 	}
	// })
	document.getElementById('log-out').addEventListener('click', async function () {
		try {
			this.parentElement.classList.remove('shown')
			token = ''
			localStorage.removeItem('token')
			await main()
		} catch (err) {
			catcher(err)
		}
	});
	document.getElementById('token-form').addEventListener('submit', async function (event) {
		try {
			event.preventDefault();
			let tinput = document.getElementById('token')
			token = tinput.value;
			tinput.value = '';
			localStorage.setItem('token', token);
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
	document.getElementById('filter').addEventListener('focus', handler(filter))
	document.getElementById('filter').addEventListener('change', handler(filter, true))
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

	try {
		await main();
	} catch (err) {
		catcher(err)
	}
});

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

function add_player_button(uid) {
	let button = title('user', uid);
	button.classList.add('box');
	button.addEventListener('click', tabhandler(compare_player, uid))
	insertSorted(button, active_tournament_tab('players'), (el) => {
		return el.textContent.toLowerCase()
	});
}
function add_active_player(id) {
	let playerbox = document.querySelector(`#player-histories div.player-history[data-playerid="${id}"]`)
	if (playerbox) {
		document.getElementById('player-histories').prepend(playerbox);
		return false;
	};

	winloss[id] = {won: 0, lost: 0}

	playerbox = document.createElement('div')
	playerbox.classList.add('player-history')
	playerbox.dataset.playerid = id

	let h2 = document.createElement('h3')
	h2.classList.add('player-name')
	playerbox.prepend(h2)

	let vsBars = document.createElement('span')
	vsBars.classList.add('vs-bars')
	vsBars.dataset.uid = id
	h2.append(vsBars)

	let vsText = document.createElement('span')
	vsText.classList.add('vs-text')
	vsText.dataset.uid = id
	vsText.innerHTML = '0 &mdash; 0 vs '
	h2.append(vsText)

	h2.append(title('user', id, 'span'))

	let merged = document.createElement('div')
	merged.classList.add('merged-tournaments')
	playerbox.append(merged)
	
	let boxgroup = document.createElement('div')
	boxgroup.classList.add('boxgroup')
	playerbox.append(fakefill(boxgroup))

	document.getElementById('player-histories').prepend(playerbox);
	return true
}
function add_player_tournament(uid, tid) {
	let trow = title('tournament', tid);
	let selector = `#player-histories div.player-history[data-playerid="${uid}"] div.merged-tournaments`
	document.querySelector(selector).append(trow)
}

function title(kind, id, element_type) {
	let element = notitle(kind, id, element_type);
	element.classList.add(kind+'-name');
	element.classList.add('title');
	let name;
	if (kind == 'user' && id == myUserId) {
		name = 'Me';
	} else {
		name = (all_data[kind][id] && all_data[kind][id].name) || (kind + id);
	}
	element.textContent = name;  // `${name} (${kind} ${id})`);
	return element;
}
function notitle(kind, id, element_type) {
	let element = document.createElement(element_type || 'div')
	element.dataset.kind = kind
	element.dataset.id = id
	return element;
}
function save_data(kind, obj) {
	let id = obj[kind+'Id'];
	if (!all_data[kind][id]) {
		all_data[kind][id] = obj;
		if (obj.name) {
			for (obj of document.querySelectorAll(`.${kind}-name[data-id="${id}"`)) {
				obj.text(obj.name);
			}
		}
		return 1
	} else {
		return 0
	}
}
function spacer() {
	let el = document.createElement('div');
	el.classList.add('spacer');
	return el
}
function update_player_standing(uid, parent) {
	let won = winloss[uid].won;
	let lost = winloss[uid].lost;
	let percent = won / (won+lost) * 100;
	
	if (!parent) {
		parent = document.querySelector(`#player-histories div.player-history[data-playerid="${uid}"]`);
	}

	let bar = parent.querySelector(`.vs-bars[data-uid="${uid}"]`);
	if (bar) {
		bar.style.cssText = `--percent: ${percent}%`;
		bar.classList.add('ready');
	}
	let text = parent.querySelector(`.vs-text[data-uid="${uid}"]`)
	if (text) text.innerHTML = `${won} &mdash; ${lost} vs `;
}
function add_player_game(options) {
	let box = game_element(options.game, false, true, options.won);
	box.style.order = options.order;
	let parent = document.querySelector(`#player-histories div.player-history[data-playerid="${options.uid}"] .boxgroup`);
	parent.append(box);
}
function add_active_game(game) {
	let box = game_element(game, true, false);
	box.addEventListener('click', tabhandler(compare_players_from_game, game.gameId));
	active_tournament_tab(game.status).append(box);
	return box;
}
function game_element(game, inc_players, inc_tournament, won) {
	let box = notitle('game', game.gameId, 'div');
	let wordrank = game.status;
	if (typeof won == 'undefined') {
		let win_rank = rankiness(game);
		if (typeof win_rank != 'undefined') {
			let percent = win_rank.place / win_rank.maxplace * 100
			box.style.cssText = `--winmix: ${percent}%`;
			box.classList.add('winmix');
			wordrank = ['1st', '2nd', '3rd', '4th'][win_rank.place];
		} else {
			wordrank = stringify(win_rank)
		}
	} else if (won === null) {
	} else {
		if (won) {
			wordrank = '(won)'
		} else {
			wordrank = '(lost)'
		}
		box.classList.toggle('won', won);
		box.classList.toggle('lost', !won);
	}
	box.classList.add('box');
	let tit = title('arena', game.arenaId);
	let wordspan = document.createElement('span');
	wordspan.textContent = wordrank;
	tit.append(wordspan);

	box.append(tit);
	if (inc_players) {
		let plist = document.createElement('ol');
		plist.classList.add('players');
		box.append(plist);
		for (uid of game.userIds) {
			let li = document.createElement('li');
			let vsBar = document.createElement('span')
			vsBar.dataset.uid = uid
			vsBar.classList.add('vs-bars')
			li.append(vsBar)
			li.append(title('user', uid, 'span'));
			plist.append(li);
		}
	}
	if (inc_tournament) {
		box.append(spacer());
		box.append(title('tournament', game.tournamentId));
	}
	return box;
}
function add_tournament(tournament, manual) {
	let tid = tournament.tournamentId
	if (my_lowest_tournament) {
		my_lowest_tournament = Math.min(my_lowest_tournament, tid)
	} else {
		my_lowest_tournament = tid
	}
	let box = title('tournament', tid);
	box.classList.add('box');
	if (manual) {
		let del = document.createElement('div')
		del.textContent = '×'
		del.title = 'remove manually added tournament'
		box.append(del)
		del.classList.add('delete-tournament')
		del.addEventListener('click', handler(remove_manual_tournament, 'event', tid))
	}
	box.addEventListener('click', tabhandler(click_tournament, tid))
	// my_tournaments_tab(tournament.status).append(box);
	insertSorted(box, my_tournaments_tab(tournament.status), (el) => {
		return -el.dataset.id;
	});
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
			await add_tournament_by_id(tid)
			manuals.push(tid)
			filter()
			return manuals
		}
	})
}
async function add_tournament_by_id(tid) {
	if (all_my_tournaments[tid]) return
	await get_tournament_details(tid)
	add_tournament(all_data.tournament[tid], true)
}
function load_more_tournaments_button(value) {
	if (!value.next) return
	let box = notitle('tournament', 0)
	box.textContent = `load page ${value.next} of ${value.last}`
	box.classList.add('fake', 'box', 'nostyle')
	box.addEventListener('click', handler(load_more_tournaments, value.next, box))
	my_tournaments_tab('completed').append(box)
}
function manual_tournament_button() {
	let box = notitle('tournament', 0)
	box.textContent = 'Add Tournament by ID...'
	box.classList.add('fake', 'box', 'nostyle')
	box.addEventListener('click', handler(add_manual_tournament))
	my_tournaments_tab('completed').append(box)
}
function my_tournaments_tab(status) {
	return tab(document.getElementById('my-tournaments'), status)
}
function active_tournament_tab(status) {
	return tab(document.getElementById('active-tournament'), status)
}
function activate_tab(boxgroup) {
	document.querySelector(`#${boxgroup.dataset.inputid}`).checked = true

}
function tab(parent, identifier) {
	let boxgroup = parent.querySelector('.boxgroup.' + `${parent.dataset.tabgroup}-${identifier}`)
	if (boxgroup) {
		return boxgroup
	}
	let id = `${parent.dataset.tabgroup}-${identifier}`

	let input_ = document.createElement('input')
	input_.type = 'radio'
	input_.name = parent.dataset.tabgroup
	input_.id = id
	input_.checked = true
	parent.append(input_)

	let label = document.createElement('label')
	label.setAttribute('for', id)
	label.textContent = identifier
	parent.append(label)

	let div = document.createElement('div')
	div.classList.add('clickables', 'boxgroup', id)
	div.dataset.inputid = id
	parent.append(div)

	fakefill(div)

	return div
}
function fakefill(element) {
	element.innerHTML = '';
	for (i=0;i<10;i++) {
		let new_el = document.createElement('div');
		new_el.classList.add('fake', 'invisible', 'box');
		element.append(new_el);
	}
	return element;
}
function notifyMe() {
	log('notifications...')
	if (!('Notification' in window)) {
		log('This browser does not support desktop notification');
	} else {
		if (Notification.permission !== 'granted' && Notification.permission != 'denied') {
			log(`Permission is ${Notification.permission}`)
			Notification.requestPermission()
		}
		log(`Notification permission is ${Notification.permission}`)
		if (Notification.permission === "granted") {
			log(`Sending notification`)
			new Notification("Hi there!", {
                body: 'This is a test notification.'
            });
		} else {
			log(`Notification permission is ${Notification.permission}`)
		}
	}
  }
  
