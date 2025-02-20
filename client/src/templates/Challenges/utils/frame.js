import { toString, flow } from 'lodash-es';
import { format } from '../../../utils/format';

// we use two different frames to make them all essentially pure functions
// main iframe is responsible rendering the preview and is where we proxy the
export const mainPreviewId = 'fcc-main-frame';
// the test frame is responsible for running the assert tests
const testId = 'fcc-test-frame';
// the project preview frame demos the finished project
export const projectPreviewId = 'fcc-project-preview-frame';

const DOCUMENT_NOT_FOUND_ERROR = 'document not found';

// base tag here will force relative links
// within iframe to point to '' instead of
// append to the current challenge url
// this also allows in-page anchors to work properly
// rather than load another instance of the learn

// window.onerror is added here to report any errors thrown during the building
// of the frame.  React dom errors already appear in the console, so onerror
// does not need to pass them on to the default error handler.
const createHeader = (id = mainPreviewId) => `
  <base href='' />
  <script>
    window.__frameId = '${id}';
    window.onerror = function(msg) {
      var string = msg.toLowerCase();
      if (string.includes('script error')) {
        msg = 'Build error, open your browser console to learn more.';
      }
      console.log(msg);
      return true;
    };
    document.addEventListener('click', function(e) {
      let element = e.target;
      while(element && element.nodeName !== 'A') {
        element = element.parentElement;
      }
      if (element) {
        const href = element.getAttribute('href');
        if (!href || href[0] !== '#' && !href.match(/^https?:\\/\\//)) {
          e.preventDefault();
        }
      }
    }, false);
    document.addEventListener('submit', function(e) {
      const action = e.target.getAttribute('action');
      if (!action || !action.match(/https?:\\/\\//)) {
        e.preventDefault();
      }
    }, false);
  </script>
`;

export const runTestInTestFrame = async function (document, test, timeout) {
  const { contentDocument: frame } = document.getElementById(testId);
  return await Promise.race([
    new Promise((_, reject) => setTimeout(() => reject('timeout'), timeout)),
    frame.__runTest(test)
  ]);
};

const createFrame = (document, id) => ctx => {
  const frame = document.createElement('iframe');
  frame.id = id;
  return {
    ...ctx,
    element: frame
  };
};

const hiddenFrameClassName = 'hide-test-frame';
const mountFrame =
  (document, id) =>
  ({ element, ...rest }) => {
    const oldFrame = document.getElementById(element.id);
    if (oldFrame) {
      element.className = oldFrame.className || hiddenFrameClassName;
      oldFrame.parentNode.replaceChild(element, oldFrame);
      // only test frames can be added (and hidden) here, other frames must be
      // added by react
    } else if (id === testId) {
      element.className = hiddenFrameClassName;
      document.body.appendChild(element);
    }
    return {
      ...rest,
      element,
      document: element.contentDocument,
      window: element.contentWindow
    };
  };

const buildProxyConsole = proxyLogger => ctx => {
  // window does not exist if the preview is hidden, so we have to check.
  if (proxyLogger && ctx?.window) {
    const oldLog = ctx.window.console.log.bind(ctx.window.console);
    ctx.window.console.log = function proxyConsole(...args) {
      proxyLogger(args.map(arg => format(arg)).join(' '));
      return oldLog(...args);
    };
  }
  return ctx;
};

const initTestFrame = frameReady => ctx => {
  waitForFrame(ctx)
    .then(async () => {
      const { sources, loadEnzyme } = ctx;
      // default for classic challenges
      // should not be used for modern
      const code = {
        contents: sources.index,
        editableContents: sources.editableContents
      };
      // provide the file name and get the original source
      const getUserInput = fileName => toString(sources[fileName]);
      await ctx.document.__initTestFrame({ code, getUserInput, loadEnzyme });
      frameReady();
    })
    .catch(handleDocumentNotFound);
  return ctx;
};

const initMainFrame = (_, proxyLogger) => ctx => {
  waitForFrame(ctx)
    .then(() => {
      // Overwriting the onerror added by createHeader to catch any errors thrown
      // after the frame is ready. It has to be overwritten, as proxyLogger cannot
      // be added as part of createHeader.
      ctx.window.onerror = function (msg) {
        var string = msg.toLowerCase();
        if (string.includes('script error')) {
          msg = 'Error, open your browser console to learn more.';
        }
        if (proxyLogger) {
          proxyLogger(msg);
        }
        // let the error propagate so it appears in the browser console, otherwise
        // an error from a cross origin script just appears as 'Script error.'
        return false;
      };
    })
    .catch(handleDocumentNotFound);
  return ctx;
};

function handleDocumentNotFound(err) {
  if (err !== DOCUMENT_NOT_FOUND_ERROR) {
    console.log(err);
  }
}

const initPreviewFrame = () => ctx => ctx;

const waitForFrame = ctx => {
  return new Promise((resolve, reject) => {
    if (!ctx.document) {
      reject(DOCUMENT_NOT_FOUND_ERROR);
    } else if (ctx.document.readyState === 'loading') {
      ctx.document.addEventListener('DOMContentLoaded', resolve);
    } else {
      resolve();
    }
  });
};

function writeToFrame(content, frame) {
  // it's possible, if the preview is rapidly opened and closed, for the frame
  // to be null at this point.
  if (frame) {
    frame.open();
    frame.write(content);
    frame.close();
  }
}

const writeContentToFrame = ctx => {
  writeToFrame(createHeader(ctx.element.id) + ctx.build, ctx.document);
  return ctx;
};

export const createMainPreviewFramer = (document, proxyLogger) =>
  createFramer(document, mainPreviewId, initMainFrame, proxyLogger);

export const createProjectPreviewFramer = document =>
  createFramer(document, projectPreviewId, initPreviewFrame);

export const createTestFramer = (document, proxyLogger, frameReady) =>
  createFramer(document, testId, initTestFrame, proxyLogger, frameReady);

const createFramer = (document, id, init, proxyLogger, frameReady) =>
  flow(
    createFrame(document, id),
    mountFrame(document, id),
    buildProxyConsole(proxyLogger),
    writeContentToFrame,
    init(frameReady, proxyLogger)
  );
