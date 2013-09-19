
afterEach(function () {

    if (global.hiveError) {
        this.test.error(new Error(global.hiveError));
        global.hiveError = null;
    }
})
