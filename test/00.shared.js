
afterEach(function () {

    if (global.hiveError) {
        this.test.error(global.hiveError);
        global.hiveError = null;
    }
})
