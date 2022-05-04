

/* global browser, serializeError */

const reportExceptionSerialized = ex => browser.runtime.sendMessage({
  command: "reportException",
  exception: ex
});

// eslint-disable-next-line no-unused-vars
const reportException = ex => reportExceptionSerialized(serializeError(ex));

// eslint-disable-next-line no-unused-vars
const reportErrorsWrap = fn => {
  try {
    return fn();
  } catch (ex) {
    reportException(ex);
    throw ex;
  }
}

// eslint-disable-next-line no-unused-vars
const reportErrorsWrapAsync = async fn => {
  try {
    return await fn();
  } catch (ex) {
    reportException(ex);
    throw ex;
  }
}