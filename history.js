// 75 lines to not overlap the html file













// 60 lines to not overlap the html file














// 45 lines to not overlap the html file














// 30 lines to not overlap the html file














// 15 lines to not overlap the html file














myUserId = 0
all_my_tournaments = {}
active_players = {}
my_pid_by_organizer = {}
all_data = {
	user: {},
	arena: {},
	tournament: {},
	game: {}
}

// log('history begin')


let limit_period = 1300;
let limit_prev = 0  // initially wrong, but irrelevant when filled with the same values anyway
let limit_phase = 0;
let limit_last = new Array(9).fill(-limit_period);
let limit_min_step = 10  // probably unnecessary
async function rate_limit() {
    let now = performance.now()
    
    let option1 = now
    let option2 = limit_last[limit_phase] + limit_period
    let option3 = limit_last[limit_prev] + limit_min_step

    let next_call = Math.max(
        option1,
        option2,
        option3
    )
    log(`Math.max(\n    ${option1}\n    ${option2}\n    ${option3}\n) = ${next_call}`)
    limit_last[limit_phase] = next_call
    limit_prev = limit_phase
    limit_phase = (limit_phase+1) % limit_last.length
    let wait = next_call - now
	await new Promise(resolve => setTimeout(resolve, wait));
	log(`waited ${wait}ms`)
    return wait
}

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

	let waited = await rate_limit()
	log(`waited ${waited}ms`)
	log(`${request_url}\n${performance.now()}`)

	try {
		const response = await fetch(req);
		if (!response.ok) {
			alert('error! logging...')
			log(`${response.url} error: ${response.status}\n\n${response.body}`)
			throw new Error(`Response status: ${response.status}`);
		}
		const json = await response.json();
		return json.data
	} catch (error) {
		alert('error... logging!')
		log(`${request_url} error:\n${error.message}`)
		throw error
	}
}

async function get_old(options) {
    let headers = Headers()
    headers['Authorization'] = `Bearer ${token}`
	headers['Content-Type'] = 'application/json'
	headers['Accept'] = 'application/json'

	let request = {}
	request.headers = headers
	let base_url = 'https://app.matchplay.events/api/'
	request.url = base_url + options.endpoint
	if (options.query) {
		request.url += '?' + $.param(options.query)
	}
	request.dataType = 'json'
	let waited = await rate_limit()
	log(`waited ${waited}ms`)
	log(`${request.url}\n${performance.now()}`)
	let requested = $.get(request)
	requested.fail(function (e) {
		log(e.message)
		throw e
	})
	response = await requested
	return response.data
};

async function get_me() {
	let data = await get({
		endpoint: 'users/profile'
	});
	myUserId = data.userId;
}

async function get_all_my_tournaments() {
	all_my_tournaments = {};
	for (tournament of (await get_tournaments(myUserId))) {
		add_tournament(tournament);
		all_my_tournaments[tournament.tournamentId] = tournament;
	}
}

async function get_tournaments(uid) {  // paginate
	let data = await get({
		endpoint: 'tournaments',
		query: {played: uid}
	});
	for (tournament of data) {
		save_data('tournament', tournament);
	};
	return data;
}
async function get_games_from_tournaments(tournaments) {
	let tids = [];
	for (tid in tournaments) {  // parallelize
		tids.push(tid);
	}
	// for (tid of tids) {
		// log(`populating games from tid ${tid}`)
		// get_and_populate_games_from_tournament(tid);
	// }
	const promises = tids.map(get_and_populate_games_from_tournament);
	await Promise.all(promises);
}
async function get_and_populate_games_from_tournament(tid) {
	let tournament = all_data.tournament[tid]
	// log(`getting games from tournament ${tournament}`)
	let tournament_games = await get_games_from_tournament(tournament)
	for (game of tournament_games) {
		// log(game.userIds);
		for (uid of game.userIds) {
			// log(uid);
			if (uid == myUserId) {
				// log('skipping, that is me')
				continue
			}
			if (active_players[uid]) {
				// log(`uid ${uid} is found in active_players: ${stringify(active_players)}`)
				let won = did_i_win(game, uid)
				if (won) {
					winloss[uid].won ++;
				} else {
					winloss[uid].lost ++;
				}
				update_player_standing(uid)
				add_player_game({
					uid: uid,
					game: game,
					won: won,
					order: -tid
				})
			};
		};
	};
	$(`#player-histories div.player-history div.merged-tournaments [data-kind="tournament"][data-id="${tid}"]`).remove();
}
async function get_games_from_tournament(tournament, add_players) {
	// log(`doing get_games_from_tournament, active players  ${stringify(active_players)}`)
	let tid = tournament.tournamentId;
	if (!tid) {
		throw Error(`no tournamentId in ${stringify(tournament)} passed into get_games_from_tournament`)
	}
	let pid;
	if (my_pid_by_organizer[tid]) {
		pid = my_pid_by_organizer[tid];
		// log(`already knew my pid: ${pid}`);
	} else {
		pid = await get_tournament_details(tournament, add_players);
		// log(`my pid: ${pid}`);
		my_pid_by_organizer[tid] = pid;
	};
	let games = await get({
		endpoint: `tournaments/${tid}/games`,
		query: {player: pid}
	});
	// log(`got ${games.length} games`);
	for (game of games) {
		save_data('game', game);
	};
	return games;
}
async function get_tournament_details(tournament, add_players) {
	let tid = tournament.tournamentId;
	// log(`getting tournament ${tid} details`);
	if (!tournament) {
		throw Error('no tournament passed into get_tournament_details')
	}
	if (add_players) {
		fakefill(document.querySelector('#players'), true)
	}
	let tournament_details = await get({
		endpoint: `tournaments/${tid}`,
		query: {
			includePlayers: 1,
			includeArenas: 1
		}
	});
	let pid;
	for (player of tournament_details.players) {
		let uid = player.claimedBy;
		if (uid == myUserId) {
			pid = player.playerId;
			continue;
		};
		if (!all_data.user[uid] && add_players) {
			all_data.user[uid] = player;
			// log(`adding player ${uid}`)
			add_player_button(uid);
		};
	};
	// log('adding arenas');
	for (arena of tournament_details.arenas) {
		save_data('arena', arena);
	};
	return pid;
}
async function get_other(id) {
	fakefill(document.querySelector('#active-games'), true)
	let tournament = all_data.tournament[id];
	active_players = {}
	let active_games = await get_games_from_tournament(tournament, true);
	// log(`active_games: ${active_games}`)
	active_games.reverse();
	$('#active-tournament-title').empty().append(title('tournament', tournament.tournamentId));
	for (game of active_games) {
		add_active_game(game);
	};
	document.querySelector('#active-tournament-title').scrollIntoView();
}
async function compare_players_from_game(id) {
	// log('welcome to compareplayersfromgame!')
	active_players = {};
	$('#player-histories').empty();  // or don't?
	winloss = {}
	// log(all_data.game);
	// log(id);
	// log(all_data.game[id]);
	let uids = all_data.game[id].userIds;
	// log(uids);
	for (uid of uids) {
		if (uid == myUserId) continue;
		// log(`adding ${uid} to active players`);
		if (add_active_player(uid)) {
			active_players[uid] = 1;
			// log(active_players);
		} else {
			// log(`${uid} already activated`)
		}
	};
	// log(`done compare_players_from_game, active players  ${stringify(active_players)}`)
	await merge_tournaments();
}
async function compare_player(id) {
	$('#player-histories').empty();  // or don't?
	active_players = {}
	active_players[id] = true
	if (add_active_player(id)) {
		await merge_tournaments()
	}
}
async function merge_tournaments() {
	// log(`merge_tournaments, active players ${stringify(active_players)}`)
	let merged_tournaments = {};
	for (uid in active_players) {
		let tournaments = await get_tournaments(uid);
		// log(`${tournaments.length} tournaments`);
		for (tournament of tournaments) {
			let tid = tournament.tournamentId
			if (all_my_tournaments[tid]) {
				add_player_tournament(uid, tid)
				merged_tournaments[tid] = true
			}
		};
	};
	// log(merged_tournaments);
	// log(`merged tournaments: ${stringify(merged_tournaments)}`);
	document.querySelector('#player-histories').scrollIntoView();
	await get_games_from_tournaments(merged_tournaments);
}
function did_i_win(game, uid) {
	let myPlayerId
	let otherPlayerId
	for (let i=0; i<game.userIds.length; i++) {
		let userId = game.userIds[i]
		let playerId = game.playerIds[i]
		if (userId == myUserId) {
			myPlayerId = playerId
		}
		if (userId == uid) {
			otherPlayerId = playerId
		}
	}
	let result = game.resultPositions
	if (!result || !result.length) {
		result = game.suggestions[0].results
	}
	return result.indexOf(myPlayerId) < result.indexOf(otherPlayerId)

}
function premain() {
    token = localStorage.getItem('token');
	if (!token) {
		$('#token-entry').show();
		$('#token-form').on('submit', async function (event) {
			event.preventDefault();
			token = $('#token').val();
			localStorage.setItem('token', token);
			main().catch(log);
		});
	} else {
		$('#token-entry').hide();
		main().catch(log);
	};
};
async function main() {
	await get_me();
	await get_all_my_tournaments();
}

////////////////////////////////////////////////////////////////

$(function() {
	try {
		premain();
	} catch (err) {
		log(err);
	}
	$('.clickables').on('click', '.box', clickthing);
});

async function clickthing() {
	try {
		for (child of this.parentNode.children) child.classList.remove('active')
		this.classList.add('active')

		let kind = $(this).data('kind');
		let id = $(this).data('id');
		switch (kind) {
			case 'tournament':
				// log('get other');
				await get_other(id);
				break;
			case 'game':
				// log('compare players from game');
				await compare_players_from_game(id);
				break;
			case 'user':
				// log('compare player');
				await compare_player(id);
				break;
			default:
				alert(`clicked a ${kind}, which isn't handled yet`);
		}
	} catch (err) {
		alert('error!')
		alert(err)
		log(`${err.message}\n${err.stack}`)
		log(err)
		this.classList.remove('active');
		this.scrollIntoView();
		throw(err)
	}
}
function insertSorted(element, parent) {
	let added = false;
	let etext = element.text().toLowerCase();
	parent.children().each(function() {
		if ((this.textContent.toLowerCase()) > etext) {  // }.localeCompare(etext, 'en', {'sensitivity': 'base'})) {
			element.insertBefore($(this));
			added = true;
			return false;
		}
	});
	if(!added) element.appendTo(parent);
}

function add_player_button(uid) {
	let button = title('user', uid).addClass('box');
	insertSorted(button, $('#players'));
}
function add_active_player(id) {
	let already_exists = $(`#player-histories div.player-history[data-playerid="${uid}"]`)
	if (already_exists.length) {
		already_exists.prependTo($('#player-histories'));
		return false;
	};
	winloss[id] = {won: 0, lost: 0}

	let playerbox = document.createElement('div')
	playerbox.classList.add('player-history')
	playerbox.dataset.playerid = id

	let h2 = document.createElement('h2')
	h2.classList.add('player-name')
	playerbox.prepend(h2)

	let vsBars = document.createElement('span')
	vsBars.classList.add('vs-bars')
	h2.append(vsBars)

	let vsText = document.createElement('span')
	vsText.classList.add('vs-text')
	vsText.innerHTML = '0 &mdash; 0 vs '
	h2.append(vsText)

	h2.append(title('user', id)[0])

	let boxgroup = document.createElement('div')
	boxgroup.classList.add('boxgroup')
	playerbox.append(fakefill(boxgroup))
	let merged = document.createElement('div')
	merged.classList.add('merged-tournaments')
	playerbox.append(merged)

	document.querySelector('#player-histories').prepend(playerbox);
	return true
}
function add_player_tournament(uid, tid) {
	let trow = title('tournament', tid, 'div').prepend('Loading ').append('...');
	let selector = `#player-histories div.player-history[data-playerid="${uid}"] div.merged-tournaments`
	trow.appendTo($(selector));
}

function title(kind, id, element_type) {
	let element = notitle(kind, id, element_type);
	element.addClass(kind+'-name');
	let name;
	if (kind == 'user' && id == myUserId) {
		name = 'Me';
	} else {
		name = (all_data[kind][id] && all_data[kind][id].name) || (kind + id);
	}
	element.text(name);  // `${name} (${kind} ${id})`);
	return element;
}
function notitle(kind, id, element_type) {
	let element = $(`<${element_type || "span"}>`);
	element.attr('data-kind', kind).attr('data-id', id);
	return element;
}
function save_data(kind, obj) {
	let id = obj[kind+'Id'];
	if (!all_data[kind][id]) {
		//log(`${kind} ${id} already known. is this bad?`)
		all_data[kind][id] = obj;
		// log(`saved ${kind} ${id}`);
		if (obj.name) {
			$(`.${kind}-name[data-id="${id}"`).text(obj.name);
		}
	}
}
function spacer() {
	return $('<div>').addClass('spacer');
}
function update_player_standing(uid) {
	let won = winloss[uid].won
	let lost = winloss[uid].lost
	let parent = document.querySelector(`#player-histories div.player-history[data-playerid="${uid}"]`)
	let percent = won / (won+lost) * 100;

	parent.querySelector('.vs-bars').style.cssText = `--percent: ${percent}%`;
	parent.querySelector('.vs-text').innerHTML = `${won} &mdash; ${lost} vs `;
}
function add_player_game(options) {
	let box = game_element(options.game, false, true);
	box.css('order', options.order)
	if (typeof did_i_win !== 'undefined') {
		box.toggleClass('won', options.won).toggleClass('lost', !options.won);
	}
	let parent = $(`#player-histories div.player-history[data-playerid="${options.uid}"] .boxgroup`);
	box.appendTo(parent);
}
function add_active_game(game) {
	let box = game_element(game, true, false);
	$('#active-games').append(box);
}
function game_element(game, inc_players, inc_tournament) {
	// log(game);
	let box = notitle('game', game.gameId, 'div').addClass('box');
	title('arena', game.arenaId).appendTo(box);
	spacer().appendTo(box);
	if (inc_players) {
		let plist = $('<ol>').addClass('players').appendTo(box);
		for (uid of game.userIds) {
			$('<li>').append(title('user', uid)).appendTo(plist);
		}
		spacer().appendTo(box);
	}
	if (inc_tournament) {
		title('tournament', game.tournamentId).appendTo(box);
	}
	return box;
}
function add_tournament(tournament) {
	title('tournament', tournament.tournamentId).addClass('box').appendTo($('#active-tournaments'));
}
function fakefill(element, empty) {
	if (empty) element.innerHTML = ''
	for (i=0;i<10;i++) {
		let new_el = document.createElement('div')
		new_el.classList.add('fake', 'box')
		element.append(new_el)
	}
	return element;
}
// log('history end');
