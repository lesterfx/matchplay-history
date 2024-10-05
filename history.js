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
	player: {},
	arena: {},
	tournament: {},
	game: {}
}

log('history begin')

async function get(options) {
	let headers = {}
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
	log(request.url)
	let requested = $.get(request)
	requested.fail(function (e) {
		log('error:')
		log(e.toString())
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

async function get_tournaments(uid) {
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
	for (tournament in tournaments) {
		log(`getting games from tournament ${tournament}`)
		await get_games_from_tournament(tournament)
	}
}
async function get_games_from_tournament(tournament) {
	if (!tournament) {
		throw Error('no tournament passed into get_games_from_tournament')
	}
	log(`doing get_games_from_tournament, active players  ${JSON.stringify(active_players, null, 4)}`)
	let tid = tournament.tournamentId;
	let pid;
	if (my_pid_by_organizer[tid]) {
		pid = my_pid_by_organizer[tid];
		log(`already knew my pid: ${pid}`);
	} else {
		pid = await get_tournament_details(tournament);
		log(`my pid: ${pid}`);
		my_pid_by_organizer[tid] = pid;
	};
	let games = await get({
		endpoint: `tournaments/${tid}/games`,
		query: {player: pid}
	});
	log(`got ${games.length} games`);
	for (game of games) {
		save_data('game', game);
		log(game.userIds)
		for (uid of game.userIds) {
			log(uid);
			if (uid == myUserId) {
				log('skipping, that is me')
				continue
			}
			log(active_players);
			if (active_players[uid]) {
				log(`${uid} is found in ${active_players}, ${JSON.stringify(active_players, null, 4)}`)
			} else {
				log(`${uid} not found in ${active_players}, ${JSON.stringify(active_players, null, 4)}`)
			};
		};
	};
	return games;
}
async function get_tournament_details(tournament) {
	let tid = tournament.tournamentId;
	log(`getting tournament ${tid} details`);
	let tournament_details = await get({
		endpoint: `tournaments/${tid}`,
		query: {
			includePlayers: 1,
			includeArenas: 1
		}
	});
	let pid;
	// log(tournament_details);
	log('adding players');
	for (player of tournament_details.players) {
		let uid = player.claimedBy;
		if (uid == myUserId) {
			pid = player.playerId;
		};
		if (!all_data.player[uid]) {
			all_data.player[uid] = player;
			add_player_button(uid);
		};
	};
	log('adding arenas');
	for (arena of tournament_details.arenas) {
		save_data('arena', arena);
	};
	return pid;
}
async function get_other(id) {
	$('#active-games').empty();
	let tournament = all_data.tournament[id];
	let active_games = await get_games_from_tournament(tournament);
	log(`active_games: ${active_games}`)
	active_games.reverse();
	$('#active-tournament-title').append(title('tournament', tournament.tournamentId));
	for (game of active_games) {
		add_active_game(game);
	};
}
async function compare_players_from_game(id) {
	log('welcome to compareplayersfromgame!')
	active_players = {};
	$('#player-histories').empty();  // or don't?
	log(JSON.stringify(all_data.game, null, 4))
	log(id)
	log(all_data.game[id])
	let uids = all_data.game[id].userIds;
	log(uids)
	for (uid of uids) {
		if (uid == myUserId) continue;
		log(`adding ${uid} to active players`)
		active_players[uid] = 1;
		log(active_players)
		add_active_player(uid);
	};
	log(`done compare_players_from_game, active players  ${JSON.stringify(active_players, null, 4)}`)
	await merge_tournaments();
}
async function compare_player(id) {
	$('#player-histories').empty();  // or don't?
	active_players = {}
	active_players[id] = true
	add_active_player(id);
	await merge_tournaments()
}
async function merge_tournaments() {
	log(`merge_tournaments, active players ${JSON.stringify(active_players, null, 4)}`)
	let merged_tournaments = {};
	for (uid in active_players) {
		let tournaments = await get_tournaments(uid);
		log(`${tournaments.length} tournaments`);
		for (tournament of tournaments) {
			let tid = tournament.tournamentId
			if (all_my_tournaments[tid]) {
				add_player_tournament(uid, tid)
				merged_tournaments[tid] = true
			}
		};
	};
	log(merged_tournaments);
	log(`merged tournaments: ${JSON.stringify(merged_tournaments, null, 4)}`);
	await get_games_from_tournaments(merged_tournaments);
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

	//todo.push(get_games_from_tournaments)
	//todo.push(get_missing_tournament_details)
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
		let kind = $(this).data('kind');
		let id = $(this).data('id');
		switch (kind) {
			case 'tournament':
				log('get other')
				await get_other(id);
				$('#active-tournament-title')[0].scrollIntoView()
				break;
				case 'game':
					log('compare players from game')
					await compare_players_from_game(id);
					$('#active-tournament-title')[0].scrollIntoView()
				break;
			case 'player':
				log('compare player')
				await compare_player(id);
				break;
			default:
				alert(`clicked a ${kind}, which isn't handled yet`);
		}
		$(this).addClass('active').siblings().removeClass('active');
	} catch (err) {
		alert('error!')
		alert(err)
		log($(`${err.message}\n${err.stack}`))
		log(err)
		throw(err)
	}
}
function insertSorted(element, parent) {
	let added = false;
	let etext = element.text().toLowerCase();
	parent.children().each(function() {
		if (($(this).text().toLowerCase()) > etext) {  // }.localeCompare(etext, 'en', {'sensitivity': 'base'})) {
			element.insertBefore($(this));
			added = true;
			return false;
		}
	});
	if(!added) element.appendTo(parent);
}

function add_player_button(uid) {
	let button = title('player', uid).addClass('box');
	insertSorted(button, $('#players'));
}
function add_active_player(id) {
	let playerbox = $('<div />').attr('data-player-id', id).addClass('player-history').appendTo($('#player-histories'));
	title('player', id, 'h3').prependTo(playerbox);
	$('<div />').addClass('boxgroup').appendTo(playerbox);
	$('<div />').addClass('merged-tournaments').appendTo(playerbox);
}

function add_player_tournament(uid, tid) {
	let trow = title('tournament', tid, 'h4');
	let selector = `#player-histories div.player-history[data-player-id="${uid}"] div.merged-tournaments`
	log(selector)
	$(selector).append(trow);
}

function title(kind, id, element_type) {
	let element = notitle(kind, id, element_type);
	element.addClass(kind+'-name');
	let name = (all_data[kind][id] && all_data[kind][id].name) || (kind + id);
	if (kind == 'player' && id == myUserId) name = 'Me';
	element.text(`${name} (${kind} ${id})`);
	return element;
}
function notitle(kind, id, element_type) {
	let element = $(`<${element_type || "span"}>`);
	element.attr('data-kind', kind).attr('data-id', id);
	return element;
}
function save_data(kind, obj) {
	let id = obj[kind+'Id'];
	if (all_data[kind][id]) {
		log(`${kind} ${id} already known. is this bad?`)
	}
	all_data[kind][id] = obj;
	log(`saved ${kind} ${id}`);
	if (obj.name) {
		$(`.${kind}-name[data-id="${id}"`).text(obj.name);
	}
}
function spacer() {
	return $('<div>').addClass('spacer');
}
function add_active_game(game) {
	log(game);
	let box = notitle('game', game.gameId, 'div').addClass('box');
	title('arena', game.arenaId).appendTo(box);
	spacer().appendTo(box);
	let plist = $('<ol>').addClass('players').appendTo(box);
	for (uid of game.userIds) {
		$('<li>').append(title('player', uid)).appendTo(plist);
	}
	spacer().appendTo(box);
	title('tournament', game.tournamentId).appendTo(box);
	$('#active-games').append(box);
}
function add_tournament(tournament) {
	title('tournament', tournament.tournamentId).addClass('box').appendTo($('#active-tournaments'));
}
log('history end');
