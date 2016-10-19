
var APPLICATION_ID = '6E4C93C2-4B30-85F7-FF5A-E7BB8612D000';
var SECRET_KEY = '72D0D6EC-48A8-25DE-FF60-5A45461B4E00';
var VERSION = 'v1';

var DEVICE_ID = "JSClient";
var FOLDER = "papers";
var files;

if( !APPLICATION_ID || !SECRET_KEY || !VERSION )
    alert( "Missing application ID and secret key arguments. Login to Backendless Console, select your app and get the ID and key from the Manage > App Settings screen. Copy/paste the values into the Backendless.initApp call located in FilesExample.js" );

function backendInit() {
    Backendless.initApp(APPLICATION_ID, SECRET_KEY, VERSION);
}

function uploadFile() {
    console.log("\n============ Uploading file ============");

    files = document.getElementById('file').files
    console.log(files);

    function successCallback(file){
        console.log("Uploaded file URL - " + file.fileURL);
    }
    function errorCallback(e){
        console.log(e);
    }
    var async = new Backendless.Async(successCallback, errorCallback);
    Backendless.Files.upload(files, FOLDER, false, async);
}
