const firstNode = document.body.childNodes[0];
firstNode.innerHTML = `<strong>JS Imported!</strong><br/>${firstNode.innerHTML}`;
document.body.prepend(firstNode);