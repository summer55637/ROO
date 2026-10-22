          const sourceAligned = sourcePixelRect.sourceAligned === true;
          if (sourceAligned) {
            // POT regions use the shared source atlas; RO surfaces may bridge UV=0/1.
            // Keep the original mip chain, but wrap both atlas axes like the RO renderer.
            sourceTexture.wrapS = THREE.RepeatWrapping;
            sourceTexture.wrapT = THREE.RepeatWrapping;
            sourceTexture.generateMipmaps = true;
            sourceTexture.minFilter = THREE.LinearMipmapLinearFilter;
            sourceTexture.magFilter = THREE.LinearFilter;
            sourceTexture.needsUpdate = true;
          }
          for (let uvAt = 0; uvAt < sourceUvAttribute.array.length; uvAt += 2) {