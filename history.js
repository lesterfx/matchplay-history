let headers = {}
let token = ''
headers['Authorization'] = `Bearer ${token}`
headers['Content-Type'] = 'application/json'
headers['Accept'] = 'application/json'

myUserId = 0
tournament_by_id = {}
my_tournaments = []
player_names = {}
players = {}
my_pid_by_organizer = {}
all_games = {}
arena_by_id = {}

async function get(options) {
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
	requested.done(function (e) {
		log('done')
	}).error(function (e) {
		log('error:')
		logobj(e)
		throw e
	}).always(function (response) {
		logobj(response)
	})
	log('waiting...')
	response = await requested
	log('got response')
	return response.data
};

async function get_me() {
	let data = await get({
		endpoint: 'users/profile'
	})
	log('got result in get_me')
	myUserId = data.userId
}

async function get_my_tournaments() {
	return await get_tournaments(myUserId)
}
async function get_tournaments(uid) {
	let data = await get({
		endpoint: 'tournaments',
		query: {played: myUserId}
	})
	data.forEach(function (tournament) {
		tournament_by_id[tournament.tournamentId] = tournament
	})
	return data
}
async function get_games_from_tournament(tournament) {
	let tid = tournament.tournamentId
	let pid
	if (my_pid_by_organizer[tid]) {
		pid = my_pid_by_organizer[tid]
		log(`already knew my pid: ${pid}`)
	} else {
		pid = await get_tournament_details(tournament)
		log(`my pid: ${pid}`)
		my_pid_by_organizer[tid] = pid
	}
	let games = await get({
		endpoint: `tournaments/${tid}/games`,
		query: {player: pid}
	})
	log('got games')
	games.forEach(function (game) {
		game.userIds.forEach(function (uid) {
			if (uid == myUserId) return
			if (players[uid]) {
				all_games[game.gameId] = game
			}
		})
	})
	logobj(all_games)
}
async function get_tournament_details(tournament) {
	let tid = tournament.tournamentId
	log(`getting tournament ${tid} details`)
	let tournament_details = await get({
		endpoint: `tournaments/${tid}`,
		query: {
			includePlayers: 1,
			includeArenas: 1
		}
	})
	let pid
	// logobj(tournament_details)
	tournament_details.players.forEach(function (player) {
		let uid = player.claimedBy
		if (uid == myUserId) {
			pid = player.playerId
		}
		players[uid] = player
		add_player_button(uid)
	})
	tournament_details.arenas.forEach(function (arena) {
		arena_by_id[arena.arenaId] = arena.name
		log(arena.name)
	})
	return pid
}
async function get_other() {
	let tournament = my_tournaments[0]
	let active_games = await get_games_from_tournament(tournament)
}
function premain() {
    let token = localStorage.getItem('token')
	if (!token) {
		$('#token-entry').show()
		alert('token needed')
		$('#token-form').on('submit', function (event) {
			event.preventDefault()
			localStorage.setItem('token', $('#token').val())
			main()
		})
	} else {
		$('#token-entry').hide()
		main()
	}
}
async function main() {
	log('get me')
	await get_me()
	log('got me')
	my_tournaments = await get_my_tournaments()
	await get_other()

	//todo.push(merge_tournaments)
	//todo.push(get_games_from_tournaments)
	//todo.push(get_missing_tournament_details)
}
let log = function (message) {
	$('#log').append($('<li>').append($('<pre>').text(message)))
}
let logobj = function (obj) {
	log(JSON.stringify(obj, null, 2))
}

log('hello world')

////////////////////////////////////////////////////////////////

$(function() {
	premain()
});

function add_player_button(uid) {
	log('add_player_button')
	let player = players[uid]
	logobj(player)
	let button = $('<div>').appendTo($('#players')).addClass('player button').text(player.name).data('uid', uid)
}