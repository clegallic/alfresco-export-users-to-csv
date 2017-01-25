var args = process.argv.slice(2);

if(args.length > 2){
	var argUrl = args[0];
	var argUsername = args[1];
	var argPassword = args[2];
	var useCache = args.length > 3 ? args[3] == 'true' : true;
	var checkAudit = args.length > 4 ? args[4] == 'true' : true;
}
else{
	console.error("Missing parameters. Usage : node AlfrescoExportUsers.js http://mydomain/alfresco <username> <password> <useCache=true|false> <checkAudit=true|false>");
	return 
}

var ALFRESCO_REPO_URL = argUrl;
var USER_LOGIN = argUsername;
var USER_PASSWORD = argPassword;
var PEOPLE_CACHE_FILE = "people.json";

var ALFRESCO_API_LOGIN_URL = ALFRESCO_REPO_URL + "/s/api/login";
var ALFRESCO_API_PEOPLE_URL = ALFRESCO_REPO_URL + "/s/api/people";
var ALFRESCO_API_AUDIT_URL = ALFRESCO_REPO_URL + "/s/api/audit/query/alfresco-access?forward=false&limit=1&verbose=false";

var loginTicket;
var progressBar;

var Client = require("node-rest-client").Client,
	csv = require('ya-csv'),  
    fs = require('fs'),
    moment = require('moment'),
    pacu = require("pacu"),
    ProgressBar = require('progress');

var client = new Client();

var loginArgs = {
    data: { username: USER_LOGIN, password: USER_PASSWORD },
    headers: { "Content-Type": "application/json" }
};

function getLastLoginDate(user){
	return new Promise((resolve, reject) => {
		if(checkAudit && user.enabled && user.authorizationStatus != "NEVER_AUTHORIZED"){
			client.get(
					ALFRESCO_API_AUDIT_URL + "&user=" + user.userName + "&alf_ticket=" + loginTicket, 
					{
						requestConfig: {
	        				timeout: 5000
	        			}
        			},
					function (data, response) {
						if(data.entries.length > 0){
							resolve(moment(data.entries[0].time).format("YYYY-MM-DD HH:mm:ss"));
						} 
						resolve(null);
					}
				).on('error', function (err) {
				    reject(err); return;
				});
		}
		else{
			resolve(null);
		}
	});
}

/**
* Create the CSV file from a list of users
*/
function createCSV(users){
	console.log("%s users found. Writing to CSV file...", users.length);
	var csfFile = csv.createCsvStreamWriter(
		fs.createWriteStream('users.csv'),
		{
	    'separator': ';',
	    'quote': '"',
	    'escape': '"',
		'encoding': 'utf16le'
		}
	);
	csfFile.writeRecord(["identifiant", "nom", "prenom","email","domaine mail", "actif ?","licence","derniere connexion"]);
	var index = 0;
	var promises = [];
	bar = new ProgressBar(':bar :current/:total (:percent)', { total: users.length, width:20 });

	for(let user of users){
		promises.push(function(){
			return getLastLoginDate(user).then(lastConnectionDate => {
					csfFile.writeRecord([
						user.userName, 
						user.firstName, 
						user.lastName, 
						user.email, 
						user.email != null ? user.email.split("@")[1] : "",
						user.enabled ? "X" : "", 
						user.authorizationStatus == "NEVER_AUTHORIZED" ? "" : "X", 
						lastConnectionDate
						]);
					bar.tick();
				})
			}
		);
	}
	pacu.series(promises);
}

function main(){
	console.log("Retrieving login ticket");
	client.post(
		ALFRESCO_API_LOGIN_URL, 
		loginArgs, 
		function(data, response){
		    loginTicket = data.data.ticket;
		    if(fs.existsSync(PEOPLE_CACHE_FILE) && useCache){
		    	console.log("Cache file %s found", PEOPLE_CACHE_FILE);
				fs.readFile(PEOPLE_CACHE_FILE, (err, data) => {
				  if (err) throw err;
				  createCSV(JSON.parse(data).people);
				});
		    }
		    else{
			    console.log("Retrieving all users with login ticket", loginTicket);
				client.get(
					ALFRESCO_API_PEOPLE_URL + "?alf_ticket=" + loginTicket, 
					function (data, response) {
						fs.writeFile(PEOPLE_CACHE_FILE, JSON.stringify(data));
					    createCSV(data.people);
					}
				);
			}
		}
	);
	console.log("Done.");
}

main();


