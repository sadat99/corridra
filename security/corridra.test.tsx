// ruleid: corridra-no-raw-html
const unsafe = <div dangerouslySetInnerHTML={{ __html: evidence }} />;
// ok: corridra-no-raw-html
const safe = <div>{evidence}</div>;
