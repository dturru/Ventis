import adsk.core, adsk.fusion, traceback


def run(context):
    ui = None
    try:
        app = adsk.core.Application.get()
        ui = app.userInterface
        design = adsk.fusion.Design.cast(app.activeProduct)
        root = design.rootComponent

        # Step 1: Select back face
        ui.messageBox('Select the BACK exterior face of the enclosure (the flat wall facing away from you).')
        sel = ui.selectEntity('Select BACK face', 'Faces')
        if not sel:
            ui.messageBox('No face selected. Cancelled.')
            return
        back_face = adsk.fusion.BRepFace.cast(sel.entity)
        body = back_face.body

        # Step 2: Create construction plane 18mm inward from back face
        planes = root.constructionPlanes
        plane_input = planes.createInput()
        offset = adsk.core.ValueInput.createByString('18 mm')
        plane_input.setByOffset(back_face, offset)
        split_plane = planes.add(plane_input)
        split_plane.name = 'Split Plane — 18mm from back'

        # Step 3: Split body at that plane
        split_feats = root.features.splitBodyFeatures
        split_input = split_feats.createInput(body, split_plane, True)
        split_feats.add(split_input)

        # Step 4: Name the two resulting bodies
        bodies = root.bRepBodies
        for b in bodies:
            bb = b.boundingBox
            depth = round((bb.maxPoint.y - bb.minPoint.y) * 10) / 10  # cm → approx
            if b != body:
                b.name = 'Front Half (23mm) — add OLED cutout here'
            else:
                b.name = 'Back Half (18mm) — standoffs + holes'

        ui.messageBox(
            'Split complete.\n\n'
            'Back half:  18mm — standoffs, SCD40 half-hole, DS18B20 half-hole\n'
            'Front half: 23mm — add OLED cutout (26x16mm, 29mm from left, 25mm from top)\n\n'
            'Next: Add M3 nut trap holes (3.2mm clearance, 5.6mm hex pocket 2.5mm deep) '
            'at 4 corners of the split face to join the halves.'
        )

    except:
        if ui:
            ui.messageBox('Script failed:\n{}'.format(traceback.format_exc()))
